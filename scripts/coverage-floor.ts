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
 * Usage: `bun scripts/coverage-floor.ts [--rust] [report]`. `--rust` reads the cargo-llvm-cov
 * report (`coverage/rust-lcov.info`) against its own floor.
 */

import { readFileSync } from "node:fs";
import { isSourceFile } from "./require-tests";

/**
 * The ratchet, read from lcov — the same LF/LH the coverage badge reports, which
 * runs a little below bun's own summary column because the two count executable
 * lines differently. Measured 99.1538 % lines / 98.1286 % functions once every
 * tracked source either appears in the report or is named in {@link COVERAGE_EXEMPT};
 * the floor is that, truncated to two decimals. Raise it as coverage climbs.
 *
 * Before that, the report left out any source no test loaded, so deleting a
 * source's only test raised the percentage instead of lowering it.
 */
export const FLOOR = { line: 0.9915, function: 0.9812 } as const;

/**
 * The Rust ratchet. Measured 95.6 % lines / 100 % functions on the first crate; the one
 * uncovered branch is a signal-handler install failure. Raise it as crates land.
 */
export const RUST_FLOOR = { line: 0.94, function: 0.9 } as const;

export type Totals = {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
};

export type Floor = { line: number; function: number };

/**
 * Sources `test:coverage` measures: the src trees of apps and packages, and scripts; `.ts` only.
 * The lcov report lists only files some test LOADS, so a source whose last test is deleted drops out
 * of the total and the percentage rises. This is the other half of the ratchet.
 */
const MEASURED = [/^apps\/[^/]+\/src\//, /^packages\/[^/]+\/src\//, /^scripts\//];

/**
 * Sources no unit test charges, each with a reason that was checked by importing the file under
 * `bun test`. Layered on the TDD gate's `isSourceFile` (type modules, barrels, declarations).
 * "Debt" entries load fine and hold branches nobody has tested yet: burn them down, never extend
 * the list to get a change through. An exempt file that IS loaded still counts.
 */
export const COVERAGE_EXEMPT: ReadonlyArray<
  { reason: string } & ({ pattern: RegExp } | { paths: readonly string[] })
> = [
  {
    pattern: /\.svelte\.ts$/,
    reason: "rune module: `$state` is undefined outside the Svelte compiler, so import throws",
  },
  { pattern: /\.gen\.ts$/, reason: "generated code" },
  {
    pattern: /^apps\/server\/src\/routes\/[^/]+\.ts$/,
    reason: "debt: route handler; loads, but only test:routes executes one",
  },
  {
    reason: "no logic: types, constant tables and cachedSetting bindings",
    paths: [
      "apps/server/src/settings/chart-palette-settings.ts",
      "apps/server/src/settings/evcc-settings.ts",
      "apps/server/src/settings/investment-settings.ts",
      "apps/server/src/settings/migration-notice-settings.ts",
      "apps/server/src/settings/statistics-prefs-settings.ts",
      "apps/server/src/settings/ui-prefs-settings.ts",
      "apps/web/src/lib/automations.ts",
      "apps/web/src/lib/components/automations/price-regime.ts",
      "apps/web/src/lib/components/automations/run-state.ts",
      "apps/web/src/lib/components/settings/inverter-types.ts",
      "apps/web/src/lib/components/settings/log-levels.ts",
      "apps/web/src/lib/components/settings/profile-types.ts",
      "apps/web/src/lib/components/ui/chart/chart-house-style.ts",
      "apps/web/src/lib/components/ui/sidebar/constants.ts",
      "apps/web/src/lib/statistics/sections.ts",
      "packages/env/src/web.ts",
    ],
  },
  {
    reason:
      "Svelte context accessors: get/setContext throw outside component init, so only the component layer calls them",
    paths: ["apps/web/src/lib/charts/fullscreen-context.ts"],
  },
  {
    reason:
      "tooling hook: Astro's content loader (`astro:content` does not resolve) and Vitest's component setup; no logic",
    paths: ["apps/docs/src/content.config.ts", "apps/web/src/component-test-setup.ts"],
  },
  {
    reason:
      "debt: builds a client or URL once at import from `$env`, `browser` and `location`; each branch needs a fresh module instance, which makes serial coverage order-dependent",
    paths: ["apps/web/src/lib/core-api.ts", "apps/web/src/lib/server-url.ts"],
  },
  {
    reason:
      "debt: loads under bun test, but every branch sits behind a Postgres query or the plant client; testing it needs a pg stand-in like settings/config.test.ts",
    paths: [
      "apps/server/src/admin/api-keys.ts",
      "apps/server/src/charts/custom-charts.ts",
      "apps/server/src/migration/onboarding-apply.ts",
      "apps/server/src/settings/logging-settings.ts",
      "apps/server/src/statistics/spot-stats.ts",
      "apps/server/src/statistics/statistics.ts",
    ],
  },
  {
    reason: "server boot: importing it reads Postgres and starts the runtime; test:routes boots it",
    paths: ["apps/server/src/index.ts", "apps/server/src/main.ts"],
  },
  {
    reason:
      "process entry or compile-time check: importing it runs it (DB connect, binary build, CLI exit, or a throw)",
    paths: [
      "packages/db/src/setup-timescale.ts",
      "packages/inverter-core/src/sdk.type-test.ts",
      "packages/profile-sdk/src/cli.ts",
      "scripts/compiled-binary.ts",
    ],
  },
  {
    reason:
      "harness for test:routes, test:budgets and the upgrade rehearsal: drives cargo, Docker, a booted core and the 1.2.0 fixture",
    paths: [
      "scripts/route-smoke-run.ts",
      "scripts/budgets-run.ts",
      "scripts/core-boot.ts",
      "scripts/upgrade-phases.ts",
      "scripts/upgrade-rehearsal.ts",
    ],
  },
];

function isExempt(path: string): boolean {
  return COVERAGE_EXEMPT.some((entry) =>
    "paths" in entry ? entry.paths.includes(path) : entry.pattern.test(path),
  );
}

/**
 * Tracked sources under the measured globs that the report never mentions, sorted. A record with
 * zero hits is still a record: the floor charges for it, this check only catches silent absence.
 */
export function unloadedSources(lcov: string, tracked: string[]): string[] {
  const loaded = new Set<string>();
  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) loaded.add(line.slice(3).trim());
  }
  return tracked
    .filter((path) => path.endsWith(".ts") && !path.includes("/dist/"))
    .filter((path) => MEASURED.some((glob) => glob.test(path)))
    .filter(isSourceFile)
    .filter((path) => !isExempt(path))
    .filter((path) => !loaded.has(path))
    .sort();
}

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
  const counters = [totals.linesFound, totals.linesHit, totals.functionsFound, totals.functionsHit];
  // A counter that did not parse (`LF:` with a truncated number, a half-written
  // report) makes every later comparison NaN, and `NaN < floor` is false — the
  // gate would wave the change through on a report it could not read. Fail loudly
  // instead; under-counting silently is the one outcome a ratchet must not have.
  if (counters.some((n) => !Number.isFinite(n))) {
    return {
      ok: false,
      lines: 0,
      functions: 0,
      failures: ["malformed coverage report — a counter did not parse as a number"],
    };
  }
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
  const pct = (v: number) => `${v.toFixed(4)} %`;
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

/**
 * Everything the CLI reaches the outside world through: the lcov file and the
 * two console streams. Injected — with the production wiring as the default, so
 * the entry point passes nothing — because the decision worth proving is which
 * report is read and what exit code a given report earns, not whether
 * `readFileSync` works.
 */
export interface FloorIo {
  /** Read the report, or throw the way `readFileSync` does when it is absent. */
  readReport(path: string): string;
  /** Every path git tracks, relative to the repo root. */
  trackedSources(): string[];
  log(message: string): void;
  error(message: string): void;
}

/** The real wiring: the filesystem, stdout for the pass line, stderr for a breach. */
export const productionIo: FloorIo = {
  readReport: (path) => readFileSync(path, "utf8"),
  trackedSources: () => {
    const proc = Bun.spawnSync(["git", "ls-files"]);
    if (proc.exitCode !== 0) throw new Error("git ls-files failed");
    return new TextDecoder().decode(proc.stdout).split("\n").filter(Boolean);
  },
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

function explainBreach(io: FloorIo, result: FloorResult): void {
  io.error("");
  io.error(
    `✖ Coverage floor breached (measured ${result.lines.toFixed(2)} % lines, ${result.functions.toFixed(2)} % functions):`,
  );
  for (const failure of result.failures) io.error(`  • ${failure}`);
  io.error("");
  io.error("  Cover the new behaviour rather than lowering FLOOR in");
  io.error("  scripts/coverage-floor.ts — the ratchet only turns one way.");
}

function explainUnloaded(io: FloorIo, unloaded: string[]): void {
  io.error("");
  io.error("✖ Coverage floor: sources no test loads (absent from the report, so uncounted):");
  for (const path of unloaded) io.error(`  • ${path}`);
  io.error("");
  io.error("  Test each, delete it if dead, or add it to COVERAGE_EXEMPT in");
  io.error("  scripts/coverage-floor.ts with the reason it cannot be loaded.");
}

/** The unloaded sources, or null when git cannot list the tree (reported on `io`). */
function findUnloaded(report: string, io: FloorIo): string[] | null {
  try {
    return unloadedSources(report, io.trackedSources());
  } catch {
    io.error("✖ Coverage floor: cannot list tracked sources — run inside the git checkout.");
    return null;
  }
}

/** The report `argv` names, else the one the matching coverage run writes. */
function reportPath(argv: string[], rust: boolean): string {
  const named = argv.find((a) => !a.startsWith("--"));
  return named ?? (rust ? "coverage/rust-lcov.info" : "coverage/lcov.info");
}

/** The report text, or null when it cannot be read (reported on `io`). */
function readReport(io: FloorIo, path: string, rust: boolean): string | null {
  try {
    return io.readReport(path);
  } catch {
    const command = rust ? "test:coverage:rust" : "test:coverage";
    io.error(`✖ Coverage floor: cannot read ${path} — run \`bun run ${command}\` first.`);
    return null;
  }
}

/**
 * The gate itself: read the report named by `argv` (default `coverage/lcov.info`, or
 * `coverage/rust-lcov.info` with `--rust`), compare it against `floor` (default: that suite's own),
 * explain the outcome and return the process exit code. The TypeScript report is also checked for
 * tracked sources it never mentions; the Rust one is not.
 */
export function main(argv: string[] = [], io: FloorIo = productionIo, floor?: Floor): number {
  const rust = argv.includes("--rust");
  const report = readReport(io, reportPath(argv, rust), rust);
  if (report === null) return 1;
  const result = checkFloor(totalsFromLcov(report), floor ?? (rust ? RUST_FLOOR : FLOOR));
  const unloaded = rust ? [] : findUnloaded(report, io);
  if (unloaded === null) return 1;
  if (result.ok && unloaded.length === 0) {
    io.log(
      `✓ Coverage floor: ${result.lines.toFixed(2)} % lines, ${result.functions.toFixed(2)} % functions.`,
    );
    return 0;
  }
  if (!result.ok) explainBreach(io, result);
  if (unloaded.length > 0) explainUnloaded(io, unloaded);
  io.error("");
  return 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
