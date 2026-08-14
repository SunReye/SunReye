#!/usr/bin/env bun
/**
 * Coverage ratchet: fail the build when the suite covers less than it did.
 *
 * bunfig.toml carries the same numbers in `coverageThreshold`, but bun only
 * COLOURS the summary red when they are missed — it still exits 0. That makes it
 * a hint, not a gate, so the real enforcement is here: parse the lcov report the
 * coverage run already writes and exit non-zero below the floor.
 *
 * Raise FLOOR as suites land. Never lower it to get a change through — a drop
 * means a behaviour lost its proof, which on a system that writes inverter
 * registers is exactly the thing that must not merge quietly.
 *
 * Usage: `bun scripts/coverage-floor.ts [coverage/lcov.info]`.
 */

import { readFileSync } from "node:fs";

/**
 * The ratchet, read from lcov — the same LF/LH the coverage badge reports, which
 * runs a little below bun's own summary column because the two count executable
 * lines differently. Measured 80.28 % lines / 79.98 % functions when this
 * landed. The floor sits about a point under that — enough that a bun version
 * counting executable lines slightly differently cannot turn a good change red,
 * not enough to absorb a dropped test suite. Raise it as coverage climbs.
 */
export const FLOOR = { line: 0.79, function: 0.79 } as const;

export type Totals = {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
};

export type Floor = { line: number; function: number };

/** Sum an lcov report's per-record line and function counters. */
export function totalsFromLcov(lcov: string): Totals {
  const totals: Totals = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };
  for (const line of lcov.split("\n")) {
    if (line.startsWith("LF:")) totals.linesFound += Number(line.slice(3));
    else if (line.startsWith("LH:")) totals.linesHit += Number(line.slice(3));
    else if (line.startsWith("FNF:")) totals.functionsFound += Number(line.slice(4));
    else if (line.startsWith("FNH:")) totals.functionsHit += Number(line.slice(4));
  }
  return totals;
}

export type FloorResult = {
  ok: boolean;
  /** Covered lines, as a percentage. */
  lines: number;
  /** Covered functions, as a percentage. */
  functions: number;
  /** One human-readable line per breached metric. */
  failures: string[];
};

/**
 * Compare totals against a floor. An empty report FAILS: zero found means the
 * suite never ran, and a build step that silently covered nothing must not read
 * as 100 %.
 */
export function checkFloor(totals: Totals, floor: Floor): FloorResult {
  const failures: string[] = [];
  if (totals.linesFound === 0 || totals.functionsFound === 0) {
    return {
      ok: false,
      lines: 0,
      functions: 0,
      failures: ["empty coverage report — the suite did not run"],
    };
  }
  const lines = (totals.linesHit / totals.linesFound) * 100;
  const functions = (totals.functionsHit / totals.functionsFound) * 100;
  const pct = (v: number) => `${v.toFixed(2)} %`;
  if (lines < floor.line * 100) {
    failures.push(`line coverage ${pct(lines)} is below the floor of ${pct(floor.line * 100)}`);
  }
  if (functions < floor.function * 100) {
    failures.push(
      `function coverage ${pct(functions)} is below the floor of ${pct(floor.function * 100)}`,
    );
  }
  return { ok: failures.length === 0, lines, functions, failures };
}

if (import.meta.main) {
  const path = process.argv[2] ?? "coverage/lcov.info";
  let report: string;
  try {
    report = readFileSync(path, "utf8");
  } catch {
    console.error(`✖ Coverage floor: cannot read ${path} — run \`bun run test:coverage\` first.`);
    process.exit(1);
  }
  const result = checkFloor(totalsFromLcov(report), FLOOR);
  if (result.ok) {
    console.log(
      `✓ Coverage floor: ${result.lines.toFixed(2)} % lines, ${result.functions.toFixed(2)} % functions.`,
    );
    process.exit(0);
  }
  console.error("");
  console.error(
    `✖ Coverage floor breached (measured ${result.lines.toFixed(2)} % lines, ${result.functions.toFixed(2)} % functions):`,
  );
  for (const failure of result.failures) console.error(`  • ${failure}`);
  console.error("");
  console.error("  Cover the new behaviour rather than lowering FLOOR in");
  console.error("  scripts/coverage-floor.ts — the ratchet only turns one way.");
  console.error("");
  process.exit(1);
}
