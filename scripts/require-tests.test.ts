import { describe, expect, test } from "bun:test";
import {
  type GateIo,
  diffCommand,
  isSourceFile,
  isTestFile,
  main,
  productionIo,
  report,
  verdict,
} from "./require-tests";

/** Capture stderr for the duration of `body`, then restore it. */
function captureStderr(body: () => void) {
  const error = console.error;
  const err: string[] = [];
  console.error = (m: string) => err.push(m);
  try {
    body();
  } finally {
    console.error = error;
  }
  return err;
}

describe("isSourceFile", () => {
  test("app and package sources count", () => {
    expect(isSourceFile("apps/server/src/cost.ts")).toBe(true);
    expect(isSourceFile("apps/web/src/lib/components/inverter/weather-tile.svelte")).toBe(true);
    expect(isSourceFile("packages/inverter-core/src/roles.ts")).toBe(true);
  });

  test("tests are not the source they cover", () => {
    expect(isSourceFile("apps/server/src/cost.test.ts")).toBe(false);
  });

  test("anything outside a workspace src tree is not source", () => {
    expect(isSourceFile("README.md")).toBe(false);
    expect(isSourceFile("apps/server/package.json")).toBe(false);
    expect(isSourceFile(".github/workflows/ci.yml")).toBe(false);
    expect(isSourceFile("apps/docs/src/content/guide.md")).toBe(false);
  });

  // Generated or declaration-only files carry no behaviour to test. Keeping the
  // list short and explicit is the point: an exemption is a decision, not a
  // default.
  test("generated and declaration-only files are exempt", () => {
    expect(isSourceFile("apps/web/src/lib/paraglide/messages.js")).toBe(false);
    expect(isSourceFile("packages/db/src/migrations/0001_init.sql")).toBe(false);
    expect(isSourceFile("apps/server/src/types.d.ts")).toBe(false);
    expect(isSourceFile("apps/web/src/app.d.ts")).toBe(false);
  });

  // Type-only modules and barrels have no runtime behaviour of their own; the
  // suite that covers the implementation covers them.
  test("type and barrel modules are exempt", () => {
    expect(isSourceFile("apps/web/src/lib/inverter/types.ts")).toBe(false);
    expect(isSourceFile("packages/inverter-core/src/index.ts")).toBe(false);
  });

  // The barrel rule is about re-exports, and an app's entry point is not one: it
  // is the composition root, where the wiring decisions live. Letting it inherit
  // the exemption is what let a 550-line `apps/server/src/index.ts` change
  // without any test moving.
  test("an app's entry point is source, whatever the barrel rule says", () => {
    expect(isSourceFile("apps/server/src/index.ts")).toBe(true);
    expect(isSourceFile("apps/web/src/index.ts")).toBe(true);
    // Still a barrel, still exempt: nested re-export modules are unaffected.
    expect(isSourceFile("apps/web/src/lib/components/ui/card/index.ts")).toBe(false);
  });

  test("route and layout shells are exempt — they wire, they do not compute", () => {
    expect(isSourceFile("apps/web/src/routes/(app)/+layout.svelte")).toBe(false);
    expect(isSourceFile("apps/web/src/routes/+error.svelte")).toBe(false);
  });
});

describe("isTestFile", () => {
  test("colocated bun tests count", () => {
    expect(isTestFile("apps/server/src/cost.test.ts")).toBe(true);
    expect(isTestFile("apps/web/src/lib/api-payload.test.ts")).toBe(true);
    expect(isTestFile("scripts/require-tests.test.ts")).toBe(true);
  });

  test("a source file is not a test", () => {
    expect(isTestFile("apps/server/src/cost.ts")).toBe(false);
  });
});

describe("verdict", () => {
  test("source with a test in the same change passes", () => {
    const v = verdict(["apps/server/src/cost.ts", "apps/server/src/cost.test.ts"]);
    expect(v.ok).toBe(true);
    expect(v.sources).toEqual(["apps/server/src/cost.ts"]);
  });

  // The rule this whole file exists for: this project drives electrical
  // hardware, so behaviour cannot land untested.
  test("source with no test in the change fails, naming the files", () => {
    const v = verdict(["apps/server/src/cost.ts", "apps/server/src/inverter.ts"]);
    expect(v.ok).toBe(false);
    expect(v.sources).toEqual(["apps/server/src/cost.ts", "apps/server/src/inverter.ts"]);
  });

  test("a docs-only or config-only change passes — there is nothing to cover", () => {
    expect(verdict(["README.md", "apps/server/package.json"]).ok).toBe(true);
  });

  test("an empty change passes", () => {
    expect(verdict([]).ok).toBe(true);
  });

  test("deleting a source file alongside its test passes", () => {
    expect(verdict(["apps/server/src/old.ts", "apps/server/src/old.test.ts"]).ok).toBe(true);
  });

  test("a test anywhere in the change satisfies the rule", () => {
    // Cross-package is legitimate: a server change is often proven through the
    // package that owns the behaviour.
    expect(
      verdict(["apps/server/src/cost.ts", "packages/inverter-core/src/roles.test.ts"]).ok,
    ).toBe(true);
  });
});

describe("report", () => {
  test("a passing verdict exits 0 and says nothing", () => {
    const lines: string[] = [];
    expect(report(verdict(["README.md"]), (l) => lines.push(l))).toBe(0);
    expect(lines).toEqual([]);
  });

  test("a failing verdict exits 1 and names every uncovered file", () => {
    const lines: string[] = [];
    const code = report(verdict(["apps/server/src/cost.ts"]), (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("apps/server/src/cost.ts");
    expect(lines.join("\n")).toContain("TDD gate");
  });
});

describe("diffCommand", () => {
  test("staged judges the index, ignoring whatever base was passed", () => {
    expect(diffCommand(true, "origin/master")).toEqual(["git", "diff", "--cached", "--name-only"]);
  });

  // Three dots: the branch against its merge base, so commits that landed on the
  // base after branching are not counted as this change's.
  test("a branch is compared against the merge base, not the base tip", () => {
    expect(diffCommand(false, "origin/dev")).toEqual([
      "git",
      "diff",
      "--name-only",
      "origin/dev...HEAD",
    ]);
    expect(diffCommand(false, "abc123")[3]).toBe("abc123...HEAD");
  });
});

/** A stand-in git: one canned result, and every command it was asked for. */
function fakeIo(result: Partial<{ exitCode: number; stdout: string; stderr: string }> = {}) {
  const commands: string[][] = [];
  const lines: string[] = [];
  const io: GateIo = {
    run: (cmd) => {
      commands.push(cmd);
      return { exitCode: 0, stdout: "", stderr: "", ...result };
    },
    log: (m) => lines.push(m),
  };
  return { io, commands, lines, output: () => lines.join("\n") };
}

describe("main", () => {
  test("with no base ref it judges the branch against origin/dev", () => {
    const f = fakeIo({ stdout: "README.md\n" });
    expect(main([], f.io)).toBe(0);
    expect(f.commands[0]).toEqual(["git", "diff", "--name-only", "origin/dev...HEAD"]);
  });

  // CI passes the PR's base commit; the pre-commit hook passes flags only.
  test("the first non-flag argument is the base ref", () => {
    const f = fakeIo({ stdout: "README.md\n" });
    main(["--warn", "deadbeef", "--staged"], f.io);
    expect(f.commands[0]).toEqual(["git", "diff", "--cached", "--name-only"]);
    main(["--warn", "deadbeef"], f.io);
    expect(f.commands[1]).toEqual(["git", "diff", "--name-only", "deadbeef...HEAD"]);
  });

  test("a flag is never mistaken for the base ref", () => {
    const f = fakeIo({ stdout: "" });
    main(["--warn"], f.io);
    expect(f.commands[0]?.[3]).toBe("origin/dev...HEAD");
  });

  test("--staged judges what is about to be committed", () => {
    const f = fakeIo({ stdout: "apps/server/src/cost.ts\n" });
    expect(main(["--staged"], f.io)).toBe(1);
    expect(f.commands[0]).toEqual(["git", "diff", "--cached", "--name-only"]);
  });

  test("source with its test in the same change lands", () => {
    const f = fakeIo({ stdout: "apps/server/src/cost.ts\napps/server/src/cost.test.ts\n" });
    expect(main([], f.io)).toBe(0);
    expect(f.lines).toEqual([]);
  });

  // The gate asks only that a test moved, not that it is the right one — proving
  // the test covers the change is review's job, and the coverage floor's.
  test("source with an unrelated test still lands — the gate counts, it does not judge", () => {
    const f = fakeIo({
      stdout: "apps/server/src/cost.ts\npackages/inverter-core/src/registry.test.ts\n",
    });
    expect(main([], f.io)).toBe(0);
  });

  test("a change of only exempt paths lands with nothing to say", () => {
    const f = fakeIo({
      stdout: [
        "apps/web/src/lib/paraglide/messages.js",
        "packages/db/src/migrations/0003_add_tariff.sql",
        "packages/inverter-core/src/index.ts",
        "apps/server/src/types.ts",
        "apps/web/src/routes/+error.svelte",
        "README.md",
        "",
      ].join("\n"),
    });
    expect(main([], f.io)).toBe(0);
    expect(f.lines).toEqual([]);
  });

  test("source with no test anywhere is blocked, naming the files", () => {
    const f = fakeIo({ stdout: "apps/server/src/cost.ts\napps/server/src/inverter.ts\n" });
    expect(main([], f.io)).toBe(1);
    expect(f.output()).toContain("apps/server/src/cost.ts");
    expect(f.output()).toContain("apps/server/src/inverter.ts");
  });

  // A commit may be a step — refactor now, its test in the next one — so the
  // hook warns. It still has to say so, or the warning is worthless.
  test("--warn reports the breach and lets the commit through anyway", () => {
    const f = fakeIo({ stdout: "apps/server/src/cost.ts\n" });
    expect(main(["--staged", "--warn"], f.io)).toBe(0);
    expect(f.output()).toContain("TDD gate: source changed, no test changed");
    expect(f.output()).toContain("apps/server/src/cost.ts");
  });

  test("an empty diff lands", () => {
    const f = fakeIo({ stdout: "" });
    expect(main([], f.io)).toBe(0);
    expect(f.lines).toEqual([]);
  });

  test("blank lines in git's output are not read as changed files", () => {
    const f = fakeIo({ stdout: "\n\napps/server/src/cost.ts\n\n" });
    expect(main([], f.io)).toBe(1);
    expect(f.output()).toContain("apps/server/src/cost.ts");
  });

  // A base ref the clone does not have (a shallow CI checkout, a stale
  // origin/dev) makes git exit non-zero with an empty diff. Reading that as "no
  // source changed" would let every change through, so it fails instead.
  test("git failing is a blocked change, not an empty diff", () => {
    const f = fakeIo({ exitCode: 128, stderr: "fatal: bad revision 'origin/dev'\n" });
    expect(main([], f.io)).toBe(1);
    expect(f.output()).toContain("cannot read the origin/dev diff");
    expect(f.output()).toContain("fatal: bad revision");
  });

  test("a failed staged read names the index rather than a ref", () => {
    const f = fakeIo({ exitCode: 128, stderr: "fatal: not a git repository\n" });
    expect(main(["--staged"], f.io)).toBe(1);
    expect(f.output()).toContain("cannot read the staged diff");
  });

  // The hook runs outside CI, on whatever state the working copy is in; a git
  // that cannot answer must not stop someone committing.
  test("--warn survives a git that cannot answer", () => {
    const f = fakeIo({ exitCode: 128, stderr: "fatal: bad revision\n" });
    expect(main(["--warn"], f.io)).toBe(0);
    expect(f.output()).toContain("cannot read the origin/dev diff");
  });
});

describe("productionIo", () => {
  test("runs the command and decodes what git said", () => {
    const r = productionIo.run(["git", "--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("git version");
    expect(r.stderr).toBe("");
  });

  // The reason the gate checks the exit code at all: git answers a question it
  // cannot resolve with an empty stdout, which would otherwise read as "nothing
  // changed" and let every source file through.
  test("a revision git cannot resolve is a non-zero code with an empty diff", () => {
    const r = productionIo.run(["git", "diff", "--name-only", "sunreye-no-such-ref...HEAD"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("fatal");
  });

  test("the report goes to stderr, so a piped stdout still shows it", () => {
    expect(captureStderr(() => productionIo.log("✖ TDD gate"))).toEqual(["✖ TDD gate"]);
  });

  test("with no wiring at all, an unresolvable base ref blocks on stderr", () => {
    let code = 0;
    const err = captureStderr(() => {
      code = main(["sunreye-no-such-ref"]);
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("cannot read the sunreye-no-such-ref diff");
  });

  test("with no wiring, --warn lets the same unresolvable ref through", () => {
    let code = 1;
    captureStderr(() => {
      code = main(["sunreye-no-such-ref", "--warn"]);
    });
    expect(code).toBe(0);
  });
});
