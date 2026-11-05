import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { STEPS, collectPaths, formatScope, main, scopeFor, type Io, type Step } from "./ci-scope";

/**
 * The scope decides which heavy gate steps a change can affect. The rule is "provably unaffected":
 * an unknown path, a shared path and an empty diff select every step. Expected selections come from
 * the ticket's examples (#488) and from what each step reads, never from the table itself.
 */

const selected = (paths: string[]): Step[] =>
  STEPS.filter((step) => scopeFor(paths)[step].run).sort();
const everything = [...STEPS].sort();
const sorted = (...steps: Step[]) => steps.sort();

describe("scopeFor", () => {
  const cases: [string, string[], Step[]][] = [
    ["docs only", ["docs/factory.md", "docs/adr/0006-budgets.md"], []],
    ["root markdown", ["README.md", "CONTRIBUTING.md"], []],
    [
      "agent and factory files",
      [".claude/agents/x.md", ".agents/skills/y/SKILL.md", "scripts/factory/slots.py"],
      [],
    ],
    [
      "appliance, add-on and plans",
      ["nixos/modules/a.nix", "sunreye/rootfs/run", "sunreye-beta/config.yaml", "plans/p.md"],
      [],
    ],
    ["the oracle generator", ["scripts/oracle/generate.ts"], []],
    ["a fixture", ["fixtures/oracle/plant.ndjson"], sorted("rust", "db", "budgets", "e2e")],
    ["a crate", ["crates/sunreye/src/live.rs"], sorted("rust", "budgets", "routes")],
    ["a crate test", ["crates/sim/tests/simulator.rs"], sorted("rust", "budgets", "routes")],
    ["the web app", ["apps/web/src/lib/a.ts"], sorted("build", "budgets", "components", "e2e")],
    [
      "the web app e2e",
      ["apps/web/e2e/a.spec.ts"],
      sorted("build", "budgets", "components", "e2e"),
    ],
    [
      "a package",
      ["packages/contracts/src/x.ts"],
      sorted("build", "budgets", "components", "e2e", "db"),
    ],
    [
      "the TypeScript server",
      ["apps/server/src/a.ts"],
      sorted("build", "budgets", "components", "e2e", "db"),
    ],
    ["the docs site", ["apps/docs/src/content/a.md"], sorted("build")],
    [
      "the OpenAPI snapshot the web client is generated from",
      ["crates/sunreye/openapi_snapshot.json"],
      sorted("rust", "budgets", "routes", "build", "components", "e2e"),
    ],
    [
      "a crate and a web file",
      ["crates/sunreye/src/a.rs", "apps/web/src/a.ts"],
      sorted("rust", "budgets", "routes", "build", "components", "e2e"),
    ],
    [
      "docs next to a crate",
      ["docs/factory.md", "crates/sunreye/src/a.rs"],
      sorted("rust", "budgets", "routes"),
    ],
    ["the gate itself", ["scripts/ci"], everything],
    ["the scope table itself", ["scripts/ci-scope.ts"], everything],
    ["the factory config", ["scripts/factory/config.json"], everything],
    ["the shell helper the gate sources", ["scripts/lib/ci-scope.sh"], everything],
    ["a root manifest", ["package.json"], everything],
    ["a root tsconfig", ["tsconfig.json"], everything],
    ["the turbo config", ["turbo.json"], everything],
    ["the cargo manifest", ["Cargo.toml"], everything],
    ["bun lockfile", ["bun.lock"], everything],
    ["cargo lockfile", ["Cargo.lock"], everything],
    ["a script no rule names", ["scripts/rust-gate"], everything],
    ["a path no rule names", ["somewhere/else.txt"], everything],
    ["a docs file beside an unknown one", ["docs/a.md", "somewhere/else.txt"], everything],
    ["an empty diff", [], everything],
  ];
  for (const [name, paths, want] of cases) {
    test(name, () => expect(selected(paths)).toEqual([...want].sort()));
  }

  // Each prefix rule ends at a path segment: a sibling that merely starts with the name is unknown.
  test("a directory rule does not claim a sibling that shares its prefix", () => {
    for (const path of [
      "crates-extra/a.rs",
      "apps/webish/a.ts",
      "docs-site/a.md",
      "fixtures-old/a.json",
    ]) {
      expect(selected([path]), path).toEqual(everything);
    }
  });

  test("a root markdown rule does not claim markdown in a directory no rule names", () => {
    expect(selected(["misc/README.md"])).toEqual(everything);
  });

  test("a directory rule claims its own root-level file", () => {
    expect(selected(["crates/Cargo.toml"])).toEqual(sorted("rust", "budgets", "routes"));
  });

  test("a hidden directory is matched, not skipped", () => {
    expect(selected([".claude/settings.json"])).toEqual([]);
  });

  test("components and e2e never run for a crate change, rust never for a web change", () => {
    const crate = scopeFor(["crates/sunreye/src/a.rs"]);
    expect([crate.components.run, crate.e2e.run]).toEqual([false, false]);
    const web = scopeFor(["apps/web/src/a.ts"]);
    expect(web.rust.run).toBe(false);
  });

  test("every step has a verdict", () => {
    expect(Object.keys(scopeFor(["docs/a.md"])).sort()).toEqual(everything);
  });

  describe("reasons", () => {
    test("a skipped step names the rules its changed paths matched", () => {
      const scope = scopeFor(["docs/factory.md", "README.md"]);
      expect(scope.rust).toEqual({ run: false, reason: "changed paths match only docs/**, *.md" });
    });

    test("a skipped step names the rule once, in path order", () => {
      const scope = scopeFor(["docs/a.md", "docs/b.md", "apps/web/src/a.ts", "docs/c.md"]);
      expect(scope.rust.reason).toBe("changed paths match only docs/**, apps/web/**");
    });

    test("a selected step names the first path that selected it", () => {
      const scope = scopeFor(["docs/a.md", "crates/sunreye/src/a.rs"]);
      expect(scope.rust).toEqual({
        run: true,
        reason: "crates/sunreye/src/a.rs matches crates/**",
      });
    });

    test("an unknown path says it is unknown", () => {
      expect(scopeFor(["somewhere/else.txt"]).rust).toEqual({
        run: true,
        reason: "somewhere/else.txt matches no rule",
      });
    });

    test("a shared path says it is shared", () => {
      expect(scopeFor(["scripts/ci"]).budgets).toEqual({
        run: true,
        reason: "scripts/ci is shared by every step",
      });
    });

    test("an empty diff says so", () => {
      expect(scopeFor([]).routes).toEqual({ run: true, reason: "empty diff" });
    });
  });

  test("--full forces every step whatever the paths", () => {
    const scope = scopeFor(["docs/a.md"], { full: true });
    expect(STEPS.every((step) => scope[step].run)).toBe(true);
    expect(scope.rust.reason).toBe("--full");
  });
});

describe("formatScope", () => {
  test("one line per step: the step, the verdict, then the reason", () => {
    const lines = formatScope(scopeFor(["docs/a.md"])).split("\n");
    expect(lines).toHaveLength(STEPS.length);
    expect(lines).toContain("rust skip changed paths match only docs/**");
    const crate = formatScope(scopeFor(["crates/sunreye/src/a.rs"])).split("\n");
    expect(crate).toContain("rust run crates/sunreye/src/a.rs matches crates/**");
    expect(crate).toContain("e2e skip changed paths match only crates/**");
  });
});

describe("collectPaths", () => {
  let repo = "";
  const git = (...args: string[]) => {
    const proc = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
    return proc.stdout.toString();
  };
  const write = (path: string, text = "x") => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ci-scope-"));
    git("init", "-q", "-b", "v4");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    write("base.txt");
    write(".gitignore", "ignored.txt\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("branch", "origin-v4");
    git("switch", "-qc", "work");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test("a clean branch has no changes", () => {
    expect(collectPaths("origin-v4", repo)).toEqual([]);
  });

  test("committed changes since the merge base are included, even when the base has moved on", () => {
    write("committed.txt");
    git("add", "-A");
    git("commit", "-qm", "work");
    git("switch", "-q", "v4");
    write("moved-on.txt");
    git("add", "-A");
    git("commit", "-qm", "base moves");
    git("branch", "-f", "origin-v4", "v4");
    git("switch", "-q", "work");
    expect(collectPaths("origin-v4", repo)).toEqual(["committed.txt"]);
  });

  test("staged, unstaged and untracked changes are included: the gate runs before the commit", () => {
    write("staged.txt");
    git("add", "staged.txt");
    write("base.txt", "edited");
    write("new/untracked.txt");
    expect(collectPaths("origin-v4", repo)).toEqual([
      "base.txt",
      "new/untracked.txt",
      "staged.txt",
    ]);
  });

  test("an ignored file is not a change", () => {
    write("ignored.txt");
    expect(collectPaths("origin-v4", repo)).toEqual([]);
  });

  test("a path is listed once however many ways it changed", () => {
    write("both.txt");
    git("add", "-A");
    git("commit", "-qm", "both");
    write("both.txt", "again");
    expect(collectPaths("origin-v4", repo)).toEqual(["both.txt"]);
  });

  test("a base that cannot be resolved yields no paths, which selects every step", () => {
    write("a.txt");
    expect(collectPaths("no-such-ref", repo)).toEqual([]);
  });
});

describe("the command", () => {
  const script = join(import.meta.dir, "ci-scope.ts");
  const bun = (args: string[], stdin = "") => {
    const proc = Bun.spawnSync(["bun", script, ...args], {
      stdin: new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
  };

  test("prints the scope of the paths on stdin", () => {
    const { code, out } = bun(["--stdin"], "docs/a.md\n\n");
    expect(code).toBe(0);
    expect(out.trimEnd().split("\n")).toContain("rust skip changed paths match only docs/**");
  });

  test("--full selects every step", () => {
    const { out } = bun(["--stdin", "--full"], "docs/a.md\n");
    expect(
      out
        .trimEnd()
        .split("\n")
        .every((line) => line.includes(" run ")),
    ).toBe(true);
  });

  test("empty stdin selects every step", () => {
    const { out } = bun(["--stdin"], "");
    expect(
      out
        .trimEnd()
        .split("\n")
        .every((line) => line.includes(" run ")),
    ).toBe(true);
  });

  test("an unknown option is refused naming the usage", () => {
    const { code, err } = bun(["--bogus"]);
    expect(code).toBe(2);
    expect(err).toContain("usage: bun scripts/ci-scope.ts");
  });
});

describe("main", () => {
  const run = (argv: string[], over: Partial<Io> = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const asked: (string | undefined)[] = [];
    const io: Io = {
      stdin: async () => "",
      repoPaths: (base) => {
        asked.push(base);
        return ["docs/a.md"];
      },
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      ...over,
    };
    return main(argv, io).then((code) => ({ code, out, err, asked }));
  };

  test("prints the scope of the repository's changed paths", async () => {
    const got = await run([]);
    expect(got.code).toBe(0);
    expect(got.out).toEqual([formatScope(scopeFor(["docs/a.md"]))]);
  });

  test("--base names the base the repository's paths are measured from", async () => {
    expect((await run(["--base", "origin/dev"])).asked).toEqual(["origin/dev"]);
    expect((await run([])).asked).toEqual([undefined]);
  });

  test("--stdin reads the paths from standard input, ignoring blank lines and padding", async () => {
    const got = await run(["--stdin"], { stdin: async () => " crates/a/src/b.rs \n\n" });
    expect(got.out).toEqual([formatScope(scopeFor(["crates/a/src/b.rs"]))]);
    expect(got.asked).toEqual([]);
  });

  test("--full selects every step", async () => {
    const got = await run(["--full"]);
    expect(got.out).toEqual([formatScope(scopeFor(["docs/a.md"], { full: true }))]);
  });

  test("an unknown option, or --base without a ref, is refused naming the usage", async () => {
    for (const argv of [["--bogus"], ["--base"]]) {
      const got = await run(argv);
      expect(got.code, argv.join(" ")).toBe(2);
      expect(got.err.join("")).toContain("usage: bun scripts/ci-scope.ts");
      expect(got.out).toEqual([]);
    }
  });
});
