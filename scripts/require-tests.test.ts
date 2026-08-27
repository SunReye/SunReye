import { describe, expect, test } from "bun:test";
import {
  type GateIo,
  cfgTestRanges,
  changedLines,
  diffCommand,
  inlineTestChanged,
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

  // A Playwright spec is a test, and for a whole class of behaviour it is the
  // ONLY test there can be: runes do not run under `bun test`, so a reactive
  // loop, a request storm or a tween that never settles is provable in a
  // browser and nowhere else. While the gate counted `*.test.ts` alone, fixing
  // one of those and covering it in `e2e/` still read as "source changed, no
  // test changed" — and the way through was to write a source-text regex
  // instead. That is how `store-backfill-wiring.test.ts` came to exist.
  test("a Playwright spec counts — for a rune shell it is the only test there is", () => {
    expect(isTestFile("apps/web/e2e/shell-lease-loop.spec.ts")).toBe(true);
    expect(isTestFile("apps/web/e2e/history-scroll-mounts.spec.ts")).toBe(true);
  });

  // Scoped to an `e2e/` directory on purpose: `.spec.ts` is not a convention
  // this repo uses anywhere else, and a bare suffix rule would let any file
  // named `foo.spec.ts` next to the source satisfy the gate without ever being
  // run by `bun test` (which globs `./src` for `*.test.ts`).
  test("a stray .spec.ts outside e2e/ does not satisfy the gate", () => {
    expect(isTestFile("apps/web/src/lib/inverter/store.spec.ts")).toBe(false);
  });

  // The harness itself is not the proof. `api-mock.ts` is a fake backend, not
  // an assertion — a change that only touched it would otherwise pass.
  test("e2e support code is not a test", () => {
    expect(isTestFile("apps/web/e2e/support/api-mock.ts")).toBe(false);
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

// ─── Rust ────────────────────────────────────────────────────────────────────
// A `.rs` file was invisible to `SOURCE_EXT`, so a Rust change would have
// bypassed the one rule this gate exists for while CI went green. Rust proves
// itself differently from TypeScript: the test usually lives INSIDE the file it
// covers (`#[cfg(test)] mod tests`), so a name-only rule cannot see it — hence
// the patch-reading below.

describe("Rust sources", () => {
  test("a crate source counts as behaviour", () => {
    expect(isSourceFile("apps/planner/src/forecast.rs")).toBe(true);
    expect(isSourceFile("packages/planner-core/src/solver.rs")).toBe(true);
  });

  // The mirror of `apps/*/src/index.ts`: an entry point is the composition
  // root, not a re-export, so it never inherits an exemption.
  test("main.rs is never exempt, whatever the mod.rs rule says", () => {
    expect(isSourceFile("apps/planner/src/main.rs")).toBe(true);
  });

  test("build scripts, generated output and re-export modules are exempt", () => {
    expect(isSourceFile("apps/planner/src/build.rs")).toBe(false);
    expect(isSourceFile("apps/planner/src/generated/registers.rs")).toBe(false);
    expect(isSourceFile("apps/planner/src/forecast/mod.rs")).toBe(false);
  });

  test("the generated exemption is Rust-only — it must not let TS through the gate", () => {
    // A bare `/generated/` pattern would exempt every language under such a
    // directory. No `generated/` dir exists today, so this guards a hole rather
    // than a regression: the day someone adds `src/generated/foo.ts`, the TDD
    // gate must still apply to it.
    expect(isSourceFile("apps/web/src/lib/generated/client.ts")).toBe(true);
    expect(isSourceFile("packages/contracts/src/generated/schema.ts")).toBe(true);
    expect(isSourceFile("apps/web/src/lib/generated/Widget.svelte")).toBe(true);
    // `generated/types.ts` stays exempt, but via the pre-existing `types.ts`
    // rule (type aliases, no runtime) — not because of the directory.
    expect(isSourceFile("packages/contracts/src/generated/types.ts")).toBe(false);
  });

  test("an integration test under tests/ is a test, not a source", () => {
    expect(isTestFile("apps/planner/tests/end_to_end.rs")).toBe(true);
    expect(isSourceFile("apps/planner/tests/end_to_end.rs")).toBe(false);
  });

  test("a .rs outside a crate src tree is neither", () => {
    expect(isSourceFile("apps/planner/build.rs")).toBe(false);
    expect(isTestFile("apps/planner/build.rs")).toBe(false);
  });
});

describe("cfgTestRanges", () => {
  test("finds the line span of an inline test module", () => {
    const src = [
      "pub fn add(a: i32, b: i32) -> i32 {", // 1
      "    a + b", // 2
      "}", // 3
      "", // 4
      "#[cfg(test)]", // 5
      "mod tests {", // 6
      "    use super::*;", // 7
      "    #[test]", // 8
      "    fn adds() {", // 9
      "        assert_eq!(add(1, 2), 3);", // 10
      "    }", // 11
      "}", // 12
    ].join("\n");
    expect(cfgTestRanges(src)).toEqual([[5, 12]]);
  });

  test("a brace inside a string or comment does not end the module early", () => {
    const src = [
      "#[cfg(test)]", // 1
      "mod tests {", // 2
      '    const S: &str = "}";', // 3
      "    // }", // 4
      "    fn f() {}", // 5
      "}", // 6
      "pub fn real() {}", // 7
    ].join("\n");
    expect(cfgTestRanges(src)).toEqual([[1, 6]]);
  });

  test("an attribute with no block covers only its own item", () => {
    const src = ["#[cfg(test)]", "use std::io;", "pub fn real() {}"].join("\n");
    expect(cfgTestRanges(src)).toEqual([[1, 2]]);
  });

  test("cfg(all(test, ...)) counts, and a plain cfg does not", () => {
    expect(cfgTestRanges(['#[cfg(all(test, feature = "x"))]', "mod t {", "}"].join("\n"))).toEqual([
      [1, 3],
    ]);
    expect(cfgTestRanges(['#[cfg(feature = "test")]', "mod t {", "}"].join("\n"))).toEqual([]);
  });

  test("a file with no test module has no ranges", () => {
    expect(cfgTestRanges("pub fn f() {}\n")).toEqual([]);
    expect(cfgTestRanges("")).toEqual([]);
  });
});

describe("changedLines", () => {
  test("added lines are reported at their new-file numbers", () => {
    const patch = [
      "diff --git a/x.rs b/x.rs",
      "--- a/x.rs",
      "+++ b/x.rs",
      "@@ -1,2 +1,4 @@",
      " fn a() {}",
      "+fn b() {}",
      "+fn c() {}",
      " fn d() {}",
    ].join("\n");
    expect(changedLines(patch)).toEqual([2, 3]);
  });

  // A pure deletion has no new-side line of its own; it still has to register,
  // or removing a test would read as "no test changed".
  test("a deletion registers at the position it was removed from", () => {
    const patch = ["@@ -10,3 +10,2 @@", " keep", "-gone", " keep"].join("\n");
    expect(changedLines(patch)).toEqual([11]);
  });

  test("several hunks are all counted", () => {
    const patch = ["@@ -1,1 +1,2 @@", " a", "+b", "@@ -20,1 +21,2 @@", " x", "+y"].join("\n");
    expect(changedLines(patch)).toEqual([2, 22]);
  });

  test("an empty or contextless patch changes nothing", () => {
    expect(changedLines("")).toEqual([]);
    expect(changedLines("diff --git a/x b/x\n")).toEqual([]);
  });
});

describe("inlineTestChanged", () => {
  const src = [
    "pub fn add(a: i32, b: i32) -> i32 {", // 1
    "    a + b", // 2
    "}", // 3
    "#[cfg(test)]", // 4
    "mod tests {", // 5
    "    #[test]", // 6
    "    fn adds() {", // 7
    "        assert_eq!(add(1, 2), 3);", // 8
    "    }", // 9
    "}", // 10
  ].join("\n");

  test("a change inside the test module counts", () => {
    const patch = ["@@ -7,2 +7,3 @@", "     fn adds() {", "+        assert!(true);"].join("\n");
    expect(inlineTestChanged(src, patch)).toBe(true);
  });

  test("a change only in the production body does not", () => {
    const patch = ["@@ -1,3 +1,3 @@", "-    a + b", "+    a + b + 0"].join("\n");
    expect(inlineTestChanged(src, patch)).toBe(false);
  });

  test("no test module at all is never satisfied", () => {
    expect(inlineTestChanged("pub fn f() {}\n", "@@ -1,1 +1,1 @@\n+pub fn f() {}")).toBe(false);
  });
});

describe("verdict with Rust", () => {
  test("a Rust source with nothing else in the change is blocked", () => {
    const v = verdict(["apps/planner/src/forecast.rs"]);
    expect(v.ok).toBe(false);
    expect(v.sources).toEqual(["apps/planner/src/forecast.rs"]);
  });

  // A TypeScript test cannot exercise a Rust function, so it does not pay for
  // one. This is stricter than the TS rule on purpose.
  test("a TypeScript test does not cover a Rust change", () => {
    expect(verdict(["apps/planner/src/forecast.rs", "apps/server/src/cost.test.ts"]).ok).toBe(
      false,
    );
  });

  test("an integration test in the same crate covers it", () => {
    expect(verdict(["apps/planner/src/forecast.rs", "apps/planner/tests/forecast.rs"]).ok).toBe(
      true,
    );
  });

  test("an integration test in a DIFFERENT crate does not", () => {
    expect(verdict(["apps/planner/src/forecast.rs", "packages/other/tests/x.rs"]).ok).toBe(false);
  });

  test("its own inline test module counts when the diff touched it", () => {
    expect(verdict(["apps/planner/src/forecast.rs"], ["apps/planner/src/forecast.rs"]).ok).toBe(
      true,
    );
  });

  test("an inline test elsewhere does not cover this file", () => {
    expect(verdict(["apps/planner/src/forecast.rs"], ["apps/planner/src/other.rs"]).ok).toBe(false);
  });

  test("exempt Rust paths pass with nothing to cover", () => {
    expect(verdict(["apps/planner/src/forecast/mod.rs", "apps/planner/build.rs"]).ok).toBe(true);
  });

  test("a mixed change needs both languages covered", () => {
    expect(
      verdict(["apps/server/src/cost.ts", "apps/planner/src/f.rs", "apps/server/src/cost.test.ts"])
        .ok,
    ).toBe(false);
    expect(
      verdict(
        ["apps/server/src/cost.ts", "apps/planner/src/f.rs", "apps/server/src/cost.test.ts"],
        ["apps/planner/src/f.rs"],
      ).ok,
    ).toBe(true);
  });
});

describe("main with Rust", () => {
  /** A stand-in git that answers the listing, a file body, and a per-file patch. */
  function rustIo(diff: string, files: Record<string, { patch?: string; body?: string }>) {
    const commands: string[][] = [];
    const lines: string[] = [];
    const io: GateIo = {
      run: (cmd) => {
        commands.push(cmd);
        if (cmd[1] === "show") {
          const path = (cmd[2] ?? "").replace(/^[^:]*:/, "");
          return { exitCode: 0, stdout: files[path]?.body ?? "", stderr: "" };
        }
        if (cmd.includes("--")) {
          const path = cmd[cmd.length - 1] ?? "";
          return { exitCode: 0, stdout: files[path]?.patch ?? "", stderr: "" };
        }
        return { exitCode: 0, stdout: diff, stderr: "" };
      },
      log: (m) => lines.push(m),
    };
    return { io, commands, output: () => lines.join("\n") };
  }

  const body = [
    "pub fn f() -> i32 {", // 1
    "    1", // 2
    "}", // 3
    "#[cfg(test)]", // 4
    "mod tests {", // 5
    "    #[test]", // 6
    "    fn works() {", // 7
    "        assert_eq!(f(), 1);", // 8
    "    }", // 9
    "}", // 10
  ].join("\n");

  test("a Rust change whose inline test module moved lands", () => {
    const f = rustIo("apps/planner/src/f.rs\n", {
      "apps/planner/src/f.rs": {
        body,
        patch: ["@@ -7,2 +7,3 @@", "     fn works() {", "+        assert!(f() > 0);"].join("\n"),
      },
    });
    expect(main([], f.io)).toBe(0);
    expect(f.output()).toBe("");
  });

  test("a Rust change that only touched production code is blocked, naming it", () => {
    const f = rustIo("apps/planner/src/f.rs\n", {
      "apps/planner/src/f.rs": {
        body,
        patch: ["@@ -1,3 +1,3 @@", " pub fn f() -> i32 {", "-    1", "+    2", " }"].join("\n"),
      },
    });
    expect(main([], f.io)).toBe(1);
    expect(f.output()).toContain("apps/planner/src/f.rs");
  });

  test("a Rust change covered under tests/ needs no patch read at all", () => {
    const f = rustIo("apps/planner/src/f.rs\napps/planner/tests/f.rs\n", {});
    expect(main([], f.io)).toBe(0);
    expect(f.commands).toHaveLength(1);
  });

  test("--staged reads the index, not HEAD, for the Rust body", () => {
    const f = rustIo("apps/planner/src/f.rs\n", {
      "apps/planner/src/f.rs": {
        body,
        patch: ["@@ -7,2 +7,3 @@", "     fn works() {", "+        assert!(f() > 0);"].join("\n"),
      },
    });
    expect(main(["--staged"], f.io)).toBe(0);
    const show = f.commands.find((c) => c[1] === "show");
    expect(show?.[2]).toBe(":apps/planner/src/f.rs");
    expect(f.commands.some((c) => c.includes("--cached") && c.includes("--"))).toBe(true);
  });

  // A file git cannot show (deleted in this change) has no inline test to find;
  // it must not crash, and it must not be waved through either.
  test("a deleted Rust source with no test in the change is blocked, not crashed", () => {
    const f = rustIo("apps/planner/src/f.rs\n", {});
    expect(main([], f.io)).toBe(1);
    expect(f.output()).toContain("apps/planner/src/f.rs");
  });
});
