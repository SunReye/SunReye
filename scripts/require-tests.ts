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
  /\/build\.rs$/, // cargo build script: not linked into the crate under test
  // Generated Rust only. Anchored on `.rs` deliberately: a bare `/generated/`
  // would exempt any future TS or Svelte file under such a directory from the
  // TDD gate, which is not what this entry is for and would be a silent hole.
  /\/generated\/.*\.rs$/,
  /\/mod\.rs$/, // the Rust barrel: re-exports only
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
 *
 * `src/main.rs` is the same argument in Rust: the binary's composition root.
 * The `mod.rs` barrel exemption above must never be read as covering it.
 */
const NEVER_EXEMPT = [/^apps\/[^/]+\/src\/index\.ts$/, /^apps\/[^/]+\/src\/main\.rs$/];

/** Extensions that can hold behaviour. Docs, JSON and SQL cannot. */
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|svelte\.ts|rs)$/;

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
  // A crate's `tests/` directory is cargo's integration-test convention: every
  // `.rs` in it is its own test binary, so the path alone proves it is a test.
  if (/(^|\/)tests\/.*\.rs$/.test(path)) return true;
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

/**
 * Judge a list of changed paths against the rule.
 *
 * `inlineTested` names the changed Rust files whose own `#[cfg(test)]` region
 * the diff touched — the caller reads that from git, because no filename can
 * show it. A Rust source needs Rust evidence: its own inline test module, or a
 * `.rs` under the same crate's `tests/`. Everything else keeps the original
 * rule, where any test in the change counts.
 */
export function verdict(changed: string[], inlineTested: string[] = []): Verdict {
  const sources = changed.filter(isSourceFile);
  const tests = changed.filter(isTestFile);
  const rust = sources.filter(isRustSource);
  const other = sources.filter((p) => !isRustSource(p));
  const rustCovered = rust.every(
    (path) =>
      inlineTested.includes(path) ||
      tests.some((t) => t.endsWith(".rs") && crateOf(t) === crateOf(path)),
  );
  const otherCovered = other.length === 0 || tests.length > 0;
  return { ok: otherCovered && rustCovered, sources, tests };
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

/**
 * The changed Rust sources whose own `#[cfg(test)]` region the diff touched.
 *
 * Only asked of files a `tests/` sibling has not already covered, so the common
 * case costs no extra git calls. A body git cannot show (a deletion) yields no
 * ranges and therefore no evidence — the change is blocked, not waved through.
 */
function inlineTestedRust(changed: string[], staged: boolean, base: string, io: GateIo): string[] {
  const tests = changed.filter(isTestFile);
  const pending = changed
    .filter(isRustSource)
    .filter((p) => !tests.some((t) => t.endsWith(".rs") && crateOf(t) === crateOf(p)));
  return pending.filter((path) => {
    const body = io.run(rustBodyCommand(staged, path));
    const patch = io.run(rustPatchCommand(staged, base, path));
    return inlineTestChanged(body.stdout, patch.stdout);
  });
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
  const code = report(verdict(changed, inlineTestedRust(changed, staged, base, io)), io.log);
  return warnOnly ? 0 : code;
}

/**
 * Rust proves itself in a place a filename cannot see. Cargo's convention puts
 * the unit tests INSIDE the file they cover (`#[cfg(test)] mod tests`), so the
 * name-only rule that works for `cost.ts` / `cost.test.ts` would read every
 * honest Rust change as "source changed, no test changed" — and the cheapest
 * way past that is a fake test, which is the exact failure mode this gate
 * exists to prevent. So for Rust the gate reads the patch: a changed line
 * inside the file's own `#[cfg(test)]` region counts, as does a `.rs` under the
 * same crate's `tests/`.
 *
 * The other half of the asymmetry: a TypeScript test cannot exercise a Rust
 * function, so it does not pay for a Rust change. Rust is covered by Rust.
 */

/** `#[cfg(test)]`, including `#[cfg(all(test, …))]` — but not `cfg(feature="test")`. */
const CFG_TEST = /#\[\s*cfg\s*\(\s*(?:all\s*\(\s*)?test\b/;

/** Blank out string/char literals and line comments, so a `"}"` cannot close a block. */
function withoutLiterals(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/\/\/.*$/, "");
}

/** How far one line moves the brace depth, literals and comments discounted. */
function braceDelta(line: string): number {
  let delta = 0;
  for (const ch of withoutLiterals(line)) {
    if (ch === "{") delta++;
    else if (ch === "}") delta--;
  }
  return delta;
}

/** The 1-based line span of the item the attribute on `start` (0-based) applies to. */
function itemRange(lines: string[], start: number): [number, number] {
  let depth = 0;
  let opened = false;
  for (let j = start; j < lines.length; j++) {
    const line = lines[j] ?? "";
    depth += braceDelta(line);
    opened = opened || withoutLiterals(line).includes("{");
    if (opened && depth <= 0) return [start + 1, j + 1];
    // An attribute on a non-block item (`#[cfg(test)] use …;`) covers that line.
    if (!opened && j > start) return [start + 1, j + 1];
  }
  return [start + 1, lines.length];
}

/** Every `#[cfg(test)]` region in `src`, as inclusive 1-based line spans. */
export function cfgTestRanges(src: string): Array<[number, number]> {
  const lines = src.split("\n");
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!CFG_TEST.test(lines[i] ?? "")) continue;
    const range = itemRange(lines, i);
    ranges.push(range);
    i = range[1] - 1;
  }
  return ranges;
}

/**
 * The new-file line numbers a unified diff touched. A deletion has no new-side
 * line of its own, so it registers at the position it was removed from —
 * otherwise deleting a test would read as no test having changed.
 */
export function changedLines(patch: string): number[] {
  const touched: number[] = [];
  let line = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("+")) touched.push(line++);
    else if (raw.startsWith("-")) touched.push(line);
    else if (raw.startsWith(" ")) line++;
  }
  return touched;
}

/** Whether `patch` touched a `#[cfg(test)]` region of the file whose body is `src`. */
export function inlineTestChanged(src: string, patch: string): boolean {
  const ranges = cfgTestRanges(src);
  if (ranges.length === 0) return false;
  return changedLines(patch).some((n) => ranges.some(([from, to]) => n >= from && n <= to));
}

/** Whether `path` is Rust behaviour, i.e. subject to the Rust evidence rule. */
export function isRustSource(path: string): boolean {
  return path.endsWith(".rs") && isSourceFile(path);
}

/** The crate a path belongs to: everything above its `src/` or `tests/` segment. */
export function crateOf(path: string): string {
  return path.replace(/\/(src|tests)\/.*$/, "");
}

/** `git show` for a file's post-change body: the index when staged, else HEAD. */
export function rustBodyCommand(staged: boolean, path: string): string[] {
  return ["git", "show", `${staged ? "" : "HEAD"}:${path}`];
}

/** `git diff` for one file's patch, over the same range the listing used. */
export function rustPatchCommand(staged: boolean, base: string, path: string): string[] {
  return staged
    ? ["git", "diff", "--cached", "--", path]
    : ["git", "diff", `${base}...HEAD`, "--", path];
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
