#!/usr/bin/env bun
/**
 * Ban tests that wait on, or assert against, the wall clock.
 *
 * A test that sleeps "long enough" or asserts "under 100 ms" passes on an idle
 * machine and flakes under load: the full gate runs several suites at once, so
 * the budget that held on the author's laptop does not hold there. Every such
 * test has a deterministic replacement (see {@link REPLACEMENTS}); the clock is
 * only ever a bound on liveness, never part of the assertion.
 *
 * Static scan of test code only: Rust `#[cfg(test)]` modules, `tests/` trees and
 * `tests.rs`; TS `*.test.ts`, `*.spec.ts` and `db-tests`. Comments and string
 * literals are blanked first, so a fixture or a doc line naming a pattern is
 * never a finding.
 *
 * Passes: paused tokio time, fake timers, an injected clock, and a
 * poll-until-predicate loop whose deadline only bounds how long it may spin.
 * An injected clock is recognised only by a `.now()` read off a value
 * (`clock.now()`) inside the assertion; a `Duration` threshold on a value whose
 * source the assertion does not show (`cost() < Duration::..`) is flagged.
 *
 * Existing offenders are counted per file in `scripts/timing-baseline.json`. A
 * file may only shrink: a new offender or a raised count fails, and a shrunk
 * count must be written back (`--write`) so the ratchet cannot be spent again.
 *
 * Usage: `bun scripts/timing-hygiene.ts [--write]`.
 */

import { join } from "node:path";
import { keepOnly, maskRust, maskTs } from "./lib/mask-source";
import { callBody } from "./mock-hygiene";

export type Rule =
  | "rust-sleep"
  | "rust-elapsed"
  | "ts-sleep"
  | "ts-wait-for-timeout"
  | "ts-elapsed";

export type Finding = { file: string; line: number; rule: Rule; replacement: string };

const REPLACEMENTS: Record<Rule, string> = {
  "rust-sleep":
    "wait on a channel, `Notify` or a poll-until-predicate loop with a deadline; to advance a timer, pause tokio time (`#[tokio::test(start_paused = true)]`)",
  "rust-elapsed":
    "assert the behaviour, not the speed; to test a duration, pause tokio time or inject a clock",
  "ts-sleep":
    "await the event itself: a promise the code resolves, a poll-until-predicate loop with a deadline, or Vitest fake timers",
  "ts-wait-for-timeout":
    "a Playwright web-first assertion (`await expect(locator).toBeVisible()`) or `expect.poll`",
  "ts-elapsed":
    "assert the behaviour, not the speed; to test a duration, inject a clock or use fake timers",
};

const BASELINE_PATH = "scripts/timing-baseline.json";

/** Which files are test code. Rust files outside `tests/` are scanned for `#[cfg(test)]` modules only. */
export function isTestFile(path: string): boolean {
  if (path.includes("node_modules/") || /(?:^|\/)target\//.test(path)) return false;
  if (path.startsWith("crates/")) return path.endsWith(".rs");
  return /\.(?:test|spec)\.ts$/.test(path) || /(?:^|\/)db-tests\/.*\.ts$/.test(path);
}

/** A Rust file that is wholly test code, so needs no `#[cfg(test)]` to be scanned. */
const rustTestFile = (path: string) => /(?:^|\/)tests\/.*\.rs$|(?:^|\/)tests\.rs$/.test(path);

/** Index of the `}` matching the `{` at `open`; the end of the text when unbalanced. */
function closingBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    if (code[i] === "}") depth--;
    if (depth === 0) return i;
  }
  return code.length;
}

/** `#[cfg(test)]` or `#[cfg(all(test, ..))]`, any further attributes, then the module or fn it gates. */
const CFG_TEST_MOD =
  /#\[cfg\((?:test|(?:all|any)\([^\]]*?(?<!not\()\btest\b[^\]]*\))\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:mod\s+\w+|(?:async\s+)?fn\s+\w+[^{;]*)\s*\{/g;

/** Everything outside `#[cfg(test)] mod name { ... }` blocks, blanked. */
function onlyCfgTestModules(masked: string): string {
  const ranges = [...masked.matchAll(CFG_TEST_MOD)].map((match): [number, number] => {
    const open = match.index + match[0].length - 1;
    return [open, closingBrace(masked, open)];
  });
  return keepOnly(masked, ranges);
}

type Block = { header: string; text: string };

type Open = { open: number; headerStart: number; parens: number };

type Scan = { stack: Open[]; parens: number; boundary: number };

/** How each structural character moves the scan: nesting, and where a statement starts. */
const STRUCTURE: Record<string, (scan: Scan, at: number) => void> = {
  "(": (scan) => void scan.parens++,
  "[": (scan) => void scan.parens++,
  ")": (scan) => void (scan.parens = Math.max(0, scan.parens - 1)),
  "]": (scan) => void (scan.parens = Math.max(0, scan.parens - 1)),
  ";": (scan, at) => void (scan.boundary = scan.parens === 0 ? at : scan.boundary),
  "{": (scan, at) => {
    scan.stack.push({ open: at, headerStart: scan.boundary + 1, parens: scan.parens });
    scan.parens = 0;
    scan.boundary = at;
  },
  "}": (scan, at) => {
    scan.parens = scan.stack.pop()?.parens ?? 0;
    scan.boundary = at;
  },
};

/** The `{` blocks still open at `index`, and the offset where the current statement began. */
function openBlocks(code: string, index: number): Scan {
  const scan: Scan = { stack: [], parens: 0, boundary: -1 };
  for (let i = 0; i < index; i++) STRUCTURE[code[i] as string]?.(scan, i);
  return scan;
}

/**
 * The blocks `{ ... }` enclosing `index`, outermost first, then the statement
 * `index` is in (a loop with a one-statement body has no braces). `header` is
 * what introduces the block (`while !ready()`, an attribute and `fn name()`),
 * `text` is header and body together.
 */
function enclosingBlocks(code: string, index: number): Block[] {
  const { stack, boundary } = openBlocks(code, index);
  const blocks = stack.map(({ open, headerStart }) => ({
    header: code.slice(headerStart, open),
    text: code.slice(headerStart, closingBrace(code, open) + 1),
  }));
  const statementEnd = code.slice(index).search(/[;}]/);
  const end = statementEnd === -1 ? code.length : index + statementEnd;
  return [
    ...blocks,
    { header: code.slice(boundary + 1, index), text: code.slice(boundary + 1, end) },
  ];
}

/** `for x in xs` / `for x of xs` walks items; it polls nothing. */
const LOOP_HEADER =
  /^\s*(?:#\[[^\]]*\]\s*)*(?:'?[A-Za-z_]\w*\s*:\s*)?(?:(?:let|const|var)\s+\w+\s*=\s*)?(?:loop|while|do|for(?![^{]*\b(?:in|of)\b))\b/;

/** What a loop mentions when it is bounded by a deadline rather than by a count. */
const DEADLINE = /\b(?:deadline|until|timeout|elapsed|Instant::now|Date\.now|performance\.now)\b/;

/** Whether `index` sits in a loop that polls for a condition and gives up at a deadline. */
function inPollLoop(code: string, index: number): boolean {
  return enclosingBlocks(code, index).some(
    (block) => LOOP_HEADER.test(block.header) && DEADLINE.test(block.text),
  );
}

/** Rust: tokio time is virtual in a test fn that pauses it, so its sleeps are instant and exact. */
function pausedFn(code: string, index: number): boolean {
  return enclosingBlocks(code, index).some(
    (block) =>
      /\bfn\s+\w+/.test(block.header) &&
      /start_paused\s*=\s*true|\bpause\s*\(\s*\)/.test(block.text),
  );
}

type Hit = { index: number; rule: Rule };

/** `sleep` and `sleep_until`, plus the names a `use ... as` binds them to. */
function rustSleep(code: string): RegExp {
  const aliases = [...code.matchAll(/\bsleep(?:_until)?\s+as\s+(\w+)/g)].map((m) => `|${m[1]}`);
  return new RegExp(
    `(?<![\\w.:])(?:(?:std::)?thread::|(?:tokio::)?time::)?(?:sleep(?:_until)?${aliases.join("")})\\s*\\(`,
    "g",
  );
}
const RUST_ASSERT = /\b(?:debug_)?assert(?:_eq|_ne)?!\s*\(/g;
const RUST_MEASURE = /\b(?:Instant::now|duration_since)\b|\.elapsed\s*\(/;
const RUST_DURATION = /\bDuration::(?:from_\w+|new)\s*\(/;
const COMPARISON = /\s[<>]=?\s/;

function rustSleeps(code: string): Hit[] {
  return [...code.matchAll(rustSleep(code))]
    .filter((match) => !/\bfn\s+$/.test(code.slice(0, match.index)))
    .filter((match) => !inPollLoop(code, match.index))
    .filter((match) => match[0].includes("thread::") || !pausedFn(code, match.index))
    .map((match) => ({ index: match.index, rule: "rust-sleep" }));
}

/** Names bound to a measured instant or duration: `let took = started.elapsed();`. */
const boundTo = (code: string, pattern: RegExp, statement: RegExp): string[] =>
  [...code.matchAll(statement)]
    .filter((m) => pattern.test(m[2] as string))
    .map((m) => m[1] as string);

const mentions = (text: string, names: string[]) =>
  names.some((name) => new RegExp(`\\b${name}\\b`).test(text));

/** A `.now()` read off a value rather than the `Instant` or `SystemTime` type: an injected clock. */
const INJECTED_NOW = /(?<!\b(?:Instant|SystemTime)\s*::\s*)\b\w+\s*\.\s*now\s*\(/;

function rustAsserts(code: string): Hit[] {
  const measured = boundTo(code, RUST_MEASURE, /\blet\s+(?:mut\s+)?(\w+)\s*(?::[^=;]+)?=([^;]*);/g);
  return [...code.matchAll(RUST_ASSERT)]
    .filter((match) => {
      const body = callBody(code, match.index);
      if (RUST_MEASURE.test(body) || mentions(body, measured)) return true;
      return RUST_DURATION.test(body) && COMPARISON.test(body) && !INJECTED_NOW.test(body);
    })
    .filter((match) => !inPollLoop(code, match.index))
    .filter((match) => !pausedFn(code, match.index))
    .map((match) => ({ index: match.index, rule: "rust-elapsed" }));
}

const TS_DELTA =
  /(?:Date\.now|performance\.now)\s*\(\s*\)\s*-|-\s*(?:Date\.now|performance\.now)\s*\(\s*\)/;
const TS_FAKE_TIMERS = /\buseFakeTimers\s*\(|\bclock\s*\.\s*install\s*\(/;

/** The end of the call whose parens open at or after `from`. */
const callEnd = (code: string, from: number) =>
  code.indexOf("(", from) + callBody(code, from).length;

/** The `expect(...)` call with every `.matcher(...)` chained after it. */
function expectStatement(code: string, from: number): string {
  let end = callEnd(code, from);
  const chain = /^\s*\.\s*\w+/;
  for (let link = chain.exec(code.slice(end)); link; link = chain.exec(code.slice(end))) {
    end += link[0].length;
    if (/^\s*\(/.test(code.slice(end))) end = callEnd(code, end);
  }
  return code.slice(from, end);
}

/** Calls to the names an `import { setTimeout as x } from "node:timers/promises"` binds. */
function promiseTimers(code: string, source: string): RegExpMatchArray[] {
  const names = [...code.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["']/g)]
    .filter((m) => /^(?:node:)?timers\/promises["']/.test(source.slice(m.index + m[0].length)))
    .flatMap((m) => [...(m[1] as string).matchAll(/\bsetTimeout(?:\s+as\s+(\w+))?/g)])
    .map((m) => m[1] ?? "setTimeout");
  return names.flatMap((name) => [...code.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g"))]);
}

function tsSleeps(code: string, source: string): Hit[] {
  const faked = TS_FAKE_TIMERS.test(code);
  const bunSleeps = [...code.matchAll(/\bBun\s*\.\s*sleep(?:Sync)?\s*\(/g)];
  const timerPromises = faked
    ? []
    : [...code.matchAll(/\bnew\s+Promise\s*(?:<[^>]*>)?\s*\(/g)].filter((m) =>
        /\bsetTimeout\b/.test(callBody(code, m.index)),
      );
  return [...bunSleeps, ...timerPromises, ...promiseTimers(code, source)]
    .filter((match) => !inPollLoop(code, match.index))
    .map((match) => ({ index: match.index, rule: "ts-sleep" }));
}

function tsWaitForTimeouts(code: string): Hit[] {
  return [...code.matchAll(/\bwaitForTimeout\s*\(/g)]
    .filter((match) => !inPollLoop(code, match.index))
    .map((match) => ({ index: match.index, rule: "ts-wait-for-timeout" }));
}

function tsAsserts(code: string): Hit[] {
  if (TS_FAKE_TIMERS.test(code)) return [];
  const deltas = boundTo(code, TS_DELTA, /\b(?:const|let|var)\s+(\w+)\s*=([^;\n]*)/g);
  return [...code.matchAll(/\bexpect\s*(?:\.\s*(?:soft|poll)\s*)?\(/g)]
    .filter((match) => {
      const statement = expectStatement(code, match.index);
      return TS_DELTA.test(statement) || mentions(statement, deltas);
    })
    .filter((match) => !inPollLoop(code, match.index))
    .map((match) => ({ index: match.index, rule: "ts-elapsed" }));
}

const hitsToFindings = (file: string, code: string, hits: Hit[]): Finding[] =>
  hits
    .map(({ index, rule }) => ({
      file,
      line: code.slice(0, index).split("\n").length,
      rule,
      replacement: REPLACEMENTS[rule],
    }))
    .sort((a, b) => a.line - b.line);

/** Every banned wait or timing assertion in `source`, a file at `file`, in line order. */
export function scanFile(file: string, source: string): Finding[] {
  if (!isTestFile(file)) return [];
  if (file.endsWith(".rs")) {
    const masked = maskRust(source);
    const code = rustTestFile(file) ? masked : onlyCfgTestModules(masked);
    return hitsToFindings(file, code, [...rustSleeps(code), ...rustAsserts(code)]);
  }
  const code = maskTs(source);
  const hits = [...tsSleeps(code, source), ...tsWaitForTimeouts(code), ...tsAsserts(code)];
  return hitsToFindings(file, code, hits);
}

export type Baseline = Record<string, number>;

export type Growth = { file: string; allowed: number; found: Finding[] };
export type Shrink = { file: string; was: number; now: number };

const groupByFile = (found: Finding[]): Map<string, Finding[]> => {
  const byFile = new Map<string, Finding[]>();
  for (const f of found) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  return byFile;
};

/** Findings against the baseline: files over their count, and files under it. */
export function measure(
  found: Finding[],
  baseline: Baseline,
): { grown: Growth[]; shrunk: Shrink[] } {
  const byFile = groupByFile(found);
  const grown = [...byFile]
    .map(([file, list]) => ({ file, allowed: baseline[file] ?? 0, found: list }))
    .filter((entry) => entry.found.length > entry.allowed);
  const shrunk = Object.entries(baseline)
    .map(([file, was]) => ({ file, was, now: byFile.get(file)?.length ?? 0 }))
    .filter((entry) => entry.now < entry.was);
  return { grown, shrunk };
}

/** Everything the CLI reaches the outside world through, injected so reporting is provable. */
export interface TimingIo {
  files(): Promise<string[]>;
  read(file: string): Promise<string>;
  readBaseline(): Promise<Baseline | null>;
  writeBaseline(baseline: Baseline): Promise<void>;
  log(message: string): void;
  error(message: string): void;
}

async function gitFiles(root: string): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard"],
    {
      stdout: "pipe",
    },
  );
  const text = await new Response(proc.stdout).text();
  return text.split("\n").filter(Boolean);
}

/** The real wiring over the repo at `root`: tracked and new files, and the baseline at `baselinePath`. */
export function fileIo(root: string, baselinePath = join(root, BASELINE_PATH)): TimingIo {
  return {
    files: async () => (await gitFiles(root)).filter((file) => isTestFile(file)),
    read: (file) => Bun.file(join(root, file)).text(),
    readBaseline: async () => {
      const file = Bun.file(baselinePath);
      return (await file.exists()) ? ((await file.json()) as Baseline) : null;
    },
    writeBaseline: async (baseline) => {
      await Bun.write(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    },
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  };
}

const sortedCounts = (found: Finding[]): Baseline =>
  Object.fromEntries(
    [...groupByFile(found)]
      .map(([file, list]): [string, number] => [file, list.length])
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );

function reportGrown(io: TimingIo, grown: Growth[]): void {
  io.error("");
  io.error("✖ Test waits on, or asserts against, the wall clock:");
  io.error("");
  for (const { file, allowed, found } of grown) {
    io.error(`  ${file}: ${found.length} found, baseline allows ${allowed}`);
    for (const f of found) io.error(`  • ${file}:${f.line} — instead: ${f.replacement}`);
  }
  io.error("");
  io.error("  The baseline only shrinks: fix the new ones, never raise a count.");
}

function reportShrunk(io: TimingIo, shrunk: Shrink[]): void {
  io.error("");
  io.error("✖ Timing baseline is stale: these files have fewer offenders than it allows.");
  io.error("");
  for (const { file, was, now } of shrunk) io.error(`  • ${file}: ${was} → ${now}`);
  io.error("");
  io.error("  Lower it so the count cannot grow back: `bun scripts/timing-hygiene.ts --write`.");
}

async function scanAll(io: TimingIo): Promise<Finding[]> {
  const found: Finding[] = [];
  for (const file of await io.files()) found.push(...scanFile(file, await io.read(file)));
  return found;
}

/** Scan, compare with the baseline, report; returns the exit code. */
export async function main(
  io: TimingIo = fileIo(join(import.meta.dir, "..")),
  argv = process.argv.slice(2),
): Promise<number> {
  const write = argv.includes("--write");
  const found = await scanAll(io);
  const existing = await io.readBaseline();
  const { grown, shrunk } = measure(found, existing ?? {});

  if (grown.length > 0 && !(write && existing === null)) {
    reportGrown(io, grown);
    return 1;
  }
  if (write) {
    await io.writeBaseline(sortedCounts(found));
    io.log(`✓ Timing baseline written: ${found.length} offenders left.`);
    return 0;
  }
  if (shrunk.length > 0) {
    reportShrunk(io, shrunk);
    return 1;
  }
  io.log(`✓ Timing hygiene: no new test waits on the clock (${found.length} baselined).`);
  return 0;
}

if (import.meta.main) process.exit(await main());
