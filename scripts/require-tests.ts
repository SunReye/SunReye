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

/** Extensions that can hold behaviour. Docs, JSON and SQL cannot. */
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|svelte\.ts)$/;

/** Whether `path` is a colocated bun test. */
export function isTestFile(path: string): boolean {
  return /\.test\.(ts|tsx|js|jsx)$/.test(path);
}

/** Whether `path` is behaviour this repo is responsible for proving. */
export function isSourceFile(path: string): boolean {
  if (isTestFile(path)) return false;
  if (!SOURCE_EXT.test(path)) return false;
  if (!SOURCE_ROOTS.some((root) => root.test(path))) return false;
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

if (import.meta.main) {
  const args = process.argv.slice(2);
  // `--warn` reports without failing: the pre-commit hook uses it, because a
  // commit is allowed to be a step (refactor now, its test in the next commit)
  // while a PR is not. CI runs the same gate without it.
  const warnOnly = args.includes("--warn");
  // `--staged` judges what is about to be committed; otherwise the whole branch
  // against a base ref.
  const staged = args.includes("--staged");
  const base = args.find((a) => !a.startsWith("--")) ?? "origin/dev";

  const cmd = staged
    ? ["git", "diff", "--cached", "--name-only"]
    : ["git", "diff", "--name-only", `${base}...HEAD`];
  const proc = Bun.spawnSync(cmd);
  if (proc.exitCode !== 0) {
    console.error(`✖ TDD gate: cannot read the ${staged ? "staged" : base} diff.`);
    console.error(new TextDecoder().decode(proc.stderr));
    process.exit(warnOnly ? 0 : 1);
  }
  const changed = new TextDecoder().decode(proc.stdout).split("\n").filter(Boolean);
  const code = report(verdict(changed));
  process.exit(warnOnly ? 0 : code);
}
