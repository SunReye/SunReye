#!/usr/bin/env bun
/**
 * TDD gate: a change that touches behaviour must also touch a test.
 *
 * This project reads and WRITES registers on grid-tied inverters and batteries.
 * An untested branch here is not a cosmetic bug — it can leave a plant exporting
 * against a feed-in limit or a battery charging on the wrong tariff. So the rule
 * is mechanical rather than advisory: source changed ⇒ a test changed with it.
 *
 * What it deliberately does NOT do: prove the test covers the change, or that it
 * was written first. Those are review's job, and the coverage floor in
 * bunfig.toml is the numeric backstop. This gate only makes "I'll add tests
 * later" impossible to merge.
 *
 * Usage: `bun scripts/require-tests.ts <base-ref>` (defaults to origin/dev).
 */

/** Workspace source trees. Nothing outside these is behaviour we own. */
const SOURCE_ROOTS = [/^apps\/[^/]+\/src\//, /^packages\/[^/]+\/src\//, /^scripts\//];

/**
 * Paths inside a source tree that carry no testable behaviour. Every entry is a
 * deliberate exemption — extend it only when a file genuinely cannot hold a
 * branch, never to get a change through.
 */
const EXEMPT = [
  /\.d\.ts$/, // declarations only
  /\/paraglide\//, // generated i18n
  /\/migrations\//, // generated SQL + journal
  /\/types\.ts$/, // type aliases, no runtime
  /\/index\.ts$/, // barrels: re-exports only
  /\/routes\/.*\/\+(layout|error)\.svelte$/, // route shells wire, they do not compute
  /\/routes\/\+(layout|error)\.svelte$/,
];

/**
 * Paths an entry above would exempt, but which do hold behaviour. Checked after
 * {@link EXEMPT}, so it is a deliberate override rather than a hole.
 *
 * An app's `src/index.ts` is the only one so far: the barrel rule says
 * "re-exports only", and an app entry point is the opposite — it is the
 * composition root, where the boot wiring and every decision that has not been
 * pushed into a module lives. Inheriting the exemption meant that file could
 * grow behaviour indefinitely with no test moving. Nested barrels
 * (`.../ui/card/index.ts`) and package entry points keep the exemption.
 */
const NEVER_EXEMPT = [/^apps\/[^/]+\/src\/index\.ts$/];

/** Extensions that can hold behaviour. Docs, JSON and SQL cannot. */
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|svelte\.ts)$/;

/**
 * Whether `path` is a colocated bun test, or a Playwright spec in an `e2e/`
 * tree.
 *
 * The browser layer counts because for a whole class of behaviour it is the
 * only proof there can be: runes do not run under `bun test`, so a reactive
 * loop, a request storm or a tween that never settles is testable in a document
 * and nowhere else. While this gate recognised `*.test.ts` alone, fixing one of
 * those and covering it in `e2e/` still read as "source changed, no test
 * changed", and the cheapest way past that was a source-text regex over the
 * fix's own text. That is a green test for broken code, and it is how
 * `apps/web/src/lib/inverter/store-backfill-wiring.test.ts` came to exist.
 *
 * Scoped to an `e2e/` segment rather than the bare `.spec.ts` suffix: nothing
 * else in this repo uses that suffix, and an unscoped rule would let a
 * `foo.spec.ts` sitting next to a source satisfy the gate while no runner ever
 * globs it (`bun test ./src` looks for `*.test.ts`; Playwright looks in `e2e/`).
 */
export function isTestFile(path: string): boolean {
  if (/\.test\.(ts|tsx|js|jsx)$/.test(path)) return true;
  return /(^|\/)e2e\/.*\.spec\.(ts|tsx|js|jsx)$/.test(path);
}

/** Whether `path` is behaviour this repo is responsible for proving. */
export function isSourceFile(path: string): boolean {
  if (isTestFile(path)) return false;
  if (!SOURCE_EXT.test(path)) return false;
  if (!SOURCE_ROOTS.some((root) => root.test(path))) return false;
  if (NEVER_EXEMPT.some((keep) => keep.test(path))) return true;
  return !EXEMPT.some((skip) => skip.test(path));
}

export type Verdict = {
  /** Whether the change may land. */
  ok: boolean;
  /** The behaviour files in the change, for the failure message. */
  sources: string[];
  /** The test files in the change. */
  tests: string[];
};

/** Judge a list of changed paths against the rule. */
export function verdict(changed: string[]): Verdict {
  const sources = changed.filter(isSourceFile);
  const tests = changed.filter(isTestFile);
  return { ok: sources.length === 0 || tests.length > 0, sources, tests };
}

/** Report a verdict for humans, and exit non-zero when the change may not land. */
export function report(v: Verdict, log = console.error): number {
  if (v.ok) return 0;
  log("");
  log("✖ TDD gate: source changed, no test changed.");
  log("");
  log("  This project drives electrical hardware. Behaviour lands with the test");
  log("  that proves it — write the failing test first, then the code.");
  log("");
  for (const file of v.sources) log(`  • ${file}`);
  log("");
  log("  Add or extend a colocated *.test.ts. If a file genuinely cannot hold a");
  log("  branch, exempt it explicitly in scripts/require-tests.ts (with a test");
  log("  for the exemption) rather than skipping the gate.");
  log("");
  return 1;
}

/**
 * Everything the CLI reaches the outside world through: git, and the stream the
 * report goes to. Injected — production wiring is the default, so the entry point
 * passes nothing — because what has to be provable is which diff a given argv
 * asks git for and what exit code the answer earns, not that `git` runs.
 */
export interface GateIo {
  /** Run a command, the way `Bun.spawnSync` does, decoded. */
  run(cmd: string[]): { exitCode: number; stdout: string; stderr: string };
  /** Where the report goes — stderr in production, so it survives a piped stdout. */
  log(message: string): void;
}

/** The real wiring: git, and stderr. */
export const productionIo: GateIo = {
  run: (cmd) => {
    const proc = Bun.spawnSync(cmd);
    const decoder = new TextDecoder();
    return {
      // A process killed by a signal reports a null code; that is a failed read.
      exitCode: proc.exitCode ?? 1,
      stdout: decoder.decode(proc.stdout),
      stderr: decoder.decode(proc.stderr),
    };
  },
  log: (message) => console.error(message),
};

/** The git command a given argv asks for: the staged change, or the whole branch. */
export function diffCommand(staged: boolean, base: string): string[] {
  return staged
    ? ["git", "diff", "--cached", "--name-only"]
    : ["git", "diff", "--name-only", `${base}...HEAD`];
}

/** The gate: read the diff `argv` names, judge it, report, return the exit code. */
export function main(argv: string[] = [], io: GateIo = productionIo): number {
  // `--warn` reports without failing: the pre-commit hook uses it, because a
  // commit is allowed to be a step (refactor now, its test in the next commit)
  // while a PR is not. CI runs the same gate without it.
  const warnOnly = argv.includes("--warn");
  // `--staged` judges what is about to be committed; otherwise the whole branch
  // against a base ref.
  const staged = argv.includes("--staged");
  const base = argv.find((a) => !a.startsWith("--")) ?? "origin/dev";

  const proc = io.run(diffCommand(staged, base));
  if (proc.exitCode !== 0) {
    io.log(`✖ TDD gate: cannot read the ${staged ? "staged" : base} diff.`);
    io.log(proc.stderr);
    return warnOnly ? 0 : 1;
  }
  const changed = proc.stdout.split("\n").filter(Boolean);
  const code = report(verdict(changed), io.log);
  return warnOnly ? 0 : code;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
