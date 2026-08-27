/**
 * The addon-1.2.0 rehearsal fixture: a throwaway TimescaleDB holding what the
 * one production 1.2.0 instance holds, so the 2.0.0 in-place migration can be
 * developed and re-run against it until it is boring.
 *
 * ## Why it is built from git rather than from a dump
 *
 * 1.2.0 runs on exactly one instance and the migration gets one attempt. The
 * obvious fixture is a `pg_dump` of that instance — but no such file exists on
 * this machine, and a fixture that cannot be rebuilt is a fixture that decays.
 * So the schema is recovered from the `addon-v1.2.0` tag itself
 * (`git show addon-v1.2.0:packages/db/src/…`) and replayed statement for
 * statement. Nothing here transcribes a schema by hand: if the tag says
 * `metrics_raw` has four columns and no `dur_ms`, that is what the fixture gets,
 * and a future reader can diff the tag instead of trusting this comment.
 *
 * The data is therefore SYNTHETIC-BUT-SCHEMA-EXACT. What that proves and what
 * it does not is spelled out in {@link PROVENANCE}.
 *
 * ## Why the state, not just the schema
 *
 * Production 1.2.0 is not "the 1.2.0 schema with rows in it". Raw retention is 7
 * days, so after two months of running, `metrics_raw` holds a week and
 * `minute_rollups` (90-day retention) is the ONLY tier covering the full
 * history. A migration rehearsed against a database where raw still spans two
 * months rehearses a situation that cannot occur. So the build refreshes all
 * three aggregates over the whole seeded span, compresses, and then drops the
 * raw chunks older than 7 days — the same order of events the real instance
 * lived through.
 *
 * ## Why a counter that restarts
 *
 * `avg/max/min` cannot express energy. The read path derives energy from
 * `max - min` per bucket, which is wrong the moment a counter resets: a bucket
 * straddling a reset reports the whole lifetime total as one bucket's energy.
 * The fixture therefore contains that case on purpose — one lifetime counter
 * with a large accumulated offset that restarts to zero mid-span, plus the daily
 * counters that reset at every midnight the way real inverter registers do. The
 * ground-truth file records the counter-aware answer AND the naive one beside
 * it, so a migration that keeps the naive arithmetic fails loudly.
 *
 * ## Safety
 *
 * Port 5432 on this host is the developer's dev database, shared with a live
 * grid-tied inverter. This script DROPs its target database, so the target is
 * pinned twice over: {@link FIXTURE_PORT} and {@link FIXTURE_DB}, refused
 * together by {@link assertFixtureTarget}, in the same spirit as
 * `apps/server/db-tests/harness.ts` refusing any name but `sunreye_dbtest`.
 *
 * Run `bun scripts/fixture-1-2-0.ts --help`.
 */
import { $, SQL } from "bun";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Snapshot, buildSnapshotSql, compareSnapshots } from "./db-parity";

// ---------------------------------------------------------------------------
// Target pinning
// ---------------------------------------------------------------------------

/** The ONLY database this script may touch. Hardcoded, never configurable. */
export const FIXTURE_DB = "sunreye_fixture_120";

/** The ONLY port this script may touch. */
export const FIXTURE_PORT = 5433;

/**
 * The developer's dev database, shared with a live grid-tied inverter. Called
 * out by name so the refusal explains *why* rather than just saying no.
 */
export const DEV_DB_PORT = 5432;

/** 1.2.0 needs no toolkit extension, so the plain TimescaleDB image suffices. */
export const FIXTURE_IMAGE = "timescale/timescaledb:2.28.2-pg17";

/** Container name. Distinct from `SunReye-timescaledb`, which is the dev database. */
export const FIXTURE_CONTAINER = "sunreye-fixture-120";

/** Trivial password: the container is throwaway and host-local. */
const FIXTURE_PASSWORD = "fixture";

/** Swap the database in a connection URL, keeping credentials, host and port. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Refuse any target that is not the fixture database on the throwaway port.
 *
 * The port is checked before the name so the one genuinely dangerous mistake —
 * pointing this at 5432 — gets the message that names the live inverter, rather
 * than a generic complaint about a database name that happens to match.
 */
export function assertFixtureTarget(url: string): void {
  const parsed = new URL(url);
  const port = parsed.port;
  if (port === String(DEV_DB_PORT)) {
    throw new Error(
      `Refusing to touch port ${DEV_DB_PORT}: that is the dev database, shared with a live ` +
        `inverter, and this script DROPs its target. The fixture lives on port ${FIXTURE_PORT}.`,
    );
  }
  if (port !== String(FIXTURE_PORT)) {
    throw new Error(
      `Refusing to touch port ${port || "(implicit)"} — the fixture may only be built on ` +
        `port ${FIXTURE_PORT}, so no ambient DATABASE_URL can ever be the target.`,
    );
  }
  const name = parsed.pathname.replace(/^\//, "");
  if (name !== FIXTURE_DB) {
    throw new Error(
      `Refusing to build the fixture in "${name || "(no database)"}" — only ${FIXTURE_DB} is allowed.`,
    );
  }
}

const fixtureUrl = () =>
  `postgres://postgres:${FIXTURE_PASSWORD}@localhost:${FIXTURE_PORT}/${FIXTURE_DB}`;
const adminUrl = () => `postgres://postgres:${FIXTURE_PASSWORD}@localhost:${FIXTURE_PORT}/postgres`;

// ---------------------------------------------------------------------------
// The value model
// ---------------------------------------------------------------------------

/**
 * How one metric's value moves over time. A declarative descriptor rather than
 * a closure, because the SAME descriptor has to be evaluated twice: in
 * TypeScript (so the arithmetic is unit-testable, and so a seeded row can be
 * checked against the model) and in SQL (so ~9.3 M rows are one
 * `generate_series` per metric instead of 9.3 M round trips). Keeping the metric
 * set, the phases and the reset points in one shared data structure means only
 * the arithmetic is expressed twice, and {@link verifyModel} then executes the
 * SQL side against the TypeScript side so even that cannot drift silently.
 */
export type Shape =
  /** A diurnal PV curve: zero overnight, peak at solar noon, varying by day. */
  | { kind: "pvPower"; peakW: number }
  /** Signed flow — charge positive, discharge negative. */
  | { kind: "signedPower"; amplitudeW: number }
  /** Battery state of charge: rises 08:00→16:00, falls overnight. */
  | { kind: "soc"; minPct: number; maxPct: number }
  /**
   * An energy counter. `dailyReset` models the inverter's day registers, which
   * return to zero at every local midnight. `restartAtMinute` models the one
   * event that breaks naive `max - min`: a lifetime counter losing its
   * accumulated total mid-span.
   */
  | {
      kind: "counter";
      ratePerDay: number;
      offset: number;
      dailyReset: boolean;
      restartAtMinute: number | null;
    }
  /** A reading that hovers near a base: voltage, current, temperature. */
  | { kind: "level"; base: number; amplitude: number; periodMinutes: number }
  /** An enum register. Constant, because a status that wobbles is noise. */
  | { kind: "status"; value: number };

export type ProfileMetric = { key: string; unit: string | null };
export type SeedMetric = ProfileMetric & { shape: Shape };

/** Minutes in a day. The cadence is 1/minute, so this is also rows per day. */
const MINUTES_PER_DAY = 1440;

/** The lifetime counter that loses its total mid-span. */
export const RESTART_METRIC = "total_energy";

/** Accumulated total the restarting counter carries before it resets. */
const LIFETIME_OFFSET_KWH = 45_000;

/** Day registers, which reset at midnight, spotted by name. */
const isDailyCounter = (key: string) => /(^day_|_day_|daily|\.day\b)/i.test(key);

/** A counter that straddles a reset is the interesting one; pick it out by name. */
const isSignedFlow = (key: string) => /\.ct\.|battery\.power|ac\.total_power/.test(key);

/**
 * Assign a shape to every profile metric from its unit and key.
 *
 * Deterministic and total: a unit this does not know becomes a `level`, so a
 * profile gaining a metric never silently seeds nothing. `spanDays` is needed
 * only to place the mid-span counter restart, which must land inside whatever
 * span the caller chose — including the 3-day `--fast` span.
 */
export function assignShapes(metrics: readonly ProfileMetric[], spanDays: number): SeedMetric[] {
  // Mid-span and mid-day: a restart at midnight would leave every daily
  // bucket's naive max-min accidentally correct, hiding the bug this proves.
  const restartAtMinute = Math.floor(spanDays / 2) * MINUTES_PER_DAY + 720;
  return metrics.map((metric, index) => ({
    ...metric,
    shape: shapeFor(metric, index, restartAtMinute),
  }));
}

type ShapeFactory = (key: string, spread: number, restartAtMinute: number) => Shape;

/**
 * One factory per unit. A table rather than a `switch` so adding a unit is a
 * line of data, and so the dispatch stays flat.
 */
const SHAPE_BY_UNIT: Record<string, ShapeFactory> = {
  kWh: (key, spread, restartAtMinute) => ({
    kind: "counter",
    ratePerDay: 30 * spread,
    offset: isDailyCounter(key) ? 0 : LIFETIME_OFFSET_KWH * spread,
    dailyReset: isDailyCounter(key),
    restartAtMinute: key === RESTART_METRIC ? restartAtMinute : null,
  }),
  W: (key, spread) =>
    isSignedFlow(key)
      ? { kind: "signedPower", amplitudeW: 2500 * spread }
      : { kind: "pvPower", peakW: 4000 * spread },
  "%": (key) =>
    /soc/i.test(key)
      ? { kind: "soc", minPct: 20, maxPct: 95 }
      : { kind: "level", base: 96, amplitude: 2, periodMinutes: 180 },
  V: (_key, spread) => ({ kind: "level", base: 233, amplitude: 4 * spread, periodMinutes: 97 }),
  A: (_key, spread) => ({ kind: "level", base: 11, amplitude: 3 * spread, periodMinutes: 61 }),
  "°C": (_key, spread) => ({ kind: "level", base: 31, amplitude: 5 * spread, periodMinutes: 720 }),
};

/** A unit with no factory still seeds something plausible, never nothing. */
const FALLBACK_SHAPE: Shape = { kind: "level", base: 10, amplitude: 2, periodMinutes: 120 };

function shapeFor(metric: ProfileMetric, index: number, restartAtMinute: number): Shape {
  if (metric.unit === null) return { kind: "status", value: 2 };
  // A little per-metric spread so sibling strings/phases are not identical.
  const spread = 1 + (index % 5) / 10;
  const make = SHAPE_BY_UNIT[metric.unit];
  return make ? make(metric.key, spread, restartAtMinute) : FALLBACK_SHAPE;
}

/**
 * The value of `shape` at minute `m` of the span. Pure, integer-indexed, and
 * mirrored exactly by {@link sqlValueExpr} — see {@link verifyModel}.
 */
export function valueAt(shape: Shape, m: number): number {
  const minuteOfDay = ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = minuteOfDay / 60;
  switch (shape.kind) {
    case "pvPower": {
      // sin() is negative outside 06:00–18:00; the clamp is the night.
      const arc = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
      return shape.peakW * arc * (0.7 + 0.3 * Math.sin(Math.floor(m / MINUTES_PER_DAY)));
    }
    case "signedPower":
      return shape.amplitudeW * Math.sin((2 * Math.PI * minuteOfDay) / MINUTES_PER_DAY);
    case "soc":
      return socAt(shape, hour);
    case "counter":
      return counterAt(shape, m, minuteOfDay);
    case "level":
      return shape.base + shape.amplitude * Math.sin((2 * Math.PI * m) / shape.periodMinutes);
    case "status":
      return shape.value;
  }
}

/** Charge leg 08:00–16:00, discharge leg the other sixteen hours. */
function socAt(shape: Extract<Shape, { kind: "soc" }>, hour: number): number {
  const span = shape.maxPct - shape.minPct;
  if (hour >= 8 && hour < 16) return shape.minPct + (span * (hour - 8)) / 8;
  // Continuous with the charge leg at both ends.
  return shape.maxPct - span * (((hour - 16 + 24) % 24) / 16);
}

/**
 * A day register returns to zero at every midnight; a lifetime register
 * accumulates from `offset` and — for the one metric that models the failure
 * case — loses the whole accumulated total at `restartAtMinute`.
 */
function counterAt(
  shape: Extract<Shape, { kind: "counter" }>,
  m: number,
  minuteOfDay: number,
): number {
  if (shape.dailyReset) return (shape.ratePerDay * minuteOfDay) / MINUTES_PER_DAY;
  const cumulative = shape.offset + (shape.ratePerDay * m) / MINUTES_PER_DAY;
  if (shape.restartAtMinute === null || m < shape.restartAtMinute) return cumulative;
  const lost = shape.offset + (shape.ratePerDay * shape.restartAtMinute) / MINUTES_PER_DAY;
  return cumulative - lost;
}

/**
 * The same arithmetic as a SQL expression over the seed subquery's columns:
 * `s.m` (minutes since span start, float8) and `s.mi` (the same as bigint, so
 * `mod` and integer division are available — Postgres has no `mod(float8)`).
 */
export function sqlValueExpr(shape: Shape): string {
  const minuteOfDay = "mod(s.mi, 1440)";
  const hour = `(${minuteOfDay}::double precision / 60)`;
  const day = "(s.mi / 1440)";
  switch (shape.kind) {
    case "pvPower":
      return (
        `greatest(0::double precision, ${shape.peakW} * sin(pi() * (${hour} - 6) / 12))` +
        ` * (0.7 + 0.3 * sin(${day}::double precision))`
      );
    case "signedPower":
      return `${shape.amplitudeW} * sin(2 * pi() * ${minuteOfDay}::double precision / 1440)`;
    case "soc": {
      const span = shape.maxPct - shape.minPct;
      // `(hour - 16 + 24) % 24` is spelled as a CASE rather than `mod`:
      // Postgres has no `mod(double precision, double precision)` and float8 ->
      // numeric is not an implicit cast, so the obvious translation does not
      // even parse. Below 16:00 the wrap is `hour + 8`, above it `hour - 16`.
      return (
        `case when ${hour} >= 8 and ${hour} < 16` +
        ` then ${shape.minPct} + ${span} * (${hour} - 8) / 8` +
        ` when ${hour} < 8 then ${shape.maxPct} - ${span} * ((${hour} + 8) / 16)` +
        ` else ${shape.maxPct} - ${span} * ((${hour} - 16) / 16) end`
      );
    }
    case "counter": {
      if (shape.dailyReset) {
        return `${shape.ratePerDay} * ${minuteOfDay}::double precision / 1440`;
      }
      const cumulative = `(${shape.offset} + ${shape.ratePerDay} * s.m / 1440)`;
      if (shape.restartAtMinute === null) return cumulative;
      const lost = shape.offset + (shape.ratePerDay * shape.restartAtMinute) / MINUTES_PER_DAY;
      return `case when s.mi >= ${shape.restartAtMinute} then ${cumulative} - ${lost} else ${cumulative} end`;
    }
    case "level":
      return `${shape.base} + ${shape.amplitude} * sin(2 * pi() * s.m / ${shape.periodMinutes})`;
    case "status":
      return `${shape.value}::double precision`;
  }
}

// ---------------------------------------------------------------------------
// Modes and the plan
// ---------------------------------------------------------------------------

export type FixtureMode = "fast" | "full";

/**
 * The `--fast` metric subset. Hand-picked rather than "the first N", so every
 * shape kind — including the restarting counter and a daily-resetting one —
 * survives into the CI fixture. A fast fixture that dropped the reset case
 * would be a fixture that proves the easy half.
 */
export const FAST_METRIC_KEYS = [
  "dc.pv1.power",
  "battery.power",
  "battery.soc",
  RESTART_METRIC,
  "day_energy",
  "ac.total_energy_bought",
  "ac.l1.voltage",
  "battery.temperature",
  "inverter.status",
] as const;

/**
 * `fast` is 10 days, not 3, on purpose: raw retention is 7 days, so a shorter
 * span would make {@link trimRaw} a no-op and the CI fixture would never reach
 * the state that matters — raw holding a week while `minute_rollups` is the only
 * tier covering the rest. 10 days still builds in seconds.
 */
const MODE_SPAN_DAYS: Record<FixtureMode, number> = { fast: 10, full: 60 };

export type FixturePlan = {
  mode: FixtureMode;
  inverterId: string;
  spanDays: number;
  cadenceSeconds: number;
  startsAt: Date;
  endsAt: Date;
  metrics: SeedMetric[];
};

/**
 * `endsAt` is passed in, never read from a clock here, so a plan is exactly
 * reproducible and a test is exact.
 */
export function buildPlan(opts: {
  mode: FixtureMode;
  endsAt: Date;
  profileMetrics: readonly ProfileMetric[];
  inverterId: string;
}): FixturePlan {
  const spanDays = MODE_SPAN_DAYS[opts.mode];
  const fast = new Set<string>(FAST_METRIC_KEYS);
  const chosen =
    opts.mode === "fast"
      ? opts.profileMetrics.filter((m) => fast.has(m.key))
      : [...opts.profileMetrics];
  if (chosen.length === 0) {
    throw new Error("no metrics selected — refusing to seed an empty fixture");
  }
  return {
    mode: opts.mode,
    inverterId: opts.inverterId,
    spanDays,
    cadenceSeconds: 60,
    startsAt: new Date(opts.endsAt.getTime() - spanDays * 86_400_000),
    endsAt: opts.endsAt,
    metrics: assignShapes(chosen, spanDays),
  };
}

export const planRowCount = (plan: FixturePlan): number =>
  plan.spanDays * MINUTES_PER_DAY * plan.metrics.length;

// ---------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------

export type TierName = "minute_rollups" | "hourly_rollups" | "daily_rollups";

export type TierSummary = {
  minBucket: string | null;
  maxBucket: string | null;
  count: number;
  /**
   * Order-independent md5 over every bucket's (bucket, metric, avg, max, min).
   *
   * The committed file cannot carry the buckets themselves — 60 days of
   * per-minute buckets across 105 metrics is 9 M rows and hundreds of MB — but
   * without bucket-level integrity a migration that preserved every count and
   * window while rewriting the values would compare clean. `null` when the
   * tier was absent, and then not compared.
   */
  digest: string | null;
};

export type EnergyRow = {
  metric: string;
  /** UTC calendar day, `YYYY-MM-DD`, matching `time_bucket('1 day', time)`. */
  day: string;
  /** Counter-aware total: the sum of increments, resets handled. */
  energy: number;
  /** What `max - min` says. Kept beside the truth so a regression is visible. */
  naive: number;
  resets: number;
};

export type RestartRow = {
  metric: string;
  at: string;
  valueBefore: number;
  valueAfter: number;
};

export type GroundTruth = {
  generatedAt: string;
  fixture: {
    mode: FixtureMode;
    inverterId: string;
    spanDays: number;
    cadenceSeconds: number;
    metricCount: number;
    rawRetentionDays: number;
  };
  tiers: Record<TierName, TierSummary>;
  raw: { minTime: string | null; maxTime: string | null; count: number };
  perMetricPerDayEnergy: EnergyRow[];
  restarts: RestartRow[];
  /** The `db-parity.ts` snapshot, so the existing differ covers the rest. */
  snapshot?: Snapshot;
};

export type CounterReading = { metric: string; time: string; value: number };

/**
 * One counter step's contribution.
 *
 * A counter that went backwards has reset, and the increment since the reset is
 * whatever the counter now reads — the same rule `counter_agg` applies, and the
 * reason the new schema uses it. Clamped at zero so a negative reading (a
 * garbled register) contributes nothing rather than subtracting energy.
 */
export function counterIncrement(prev: number, next: number): number {
  // Both ends are clamped first: an energy counter cannot be negative, so a
  // negative reading is a garbled register, and it must contribute nothing
  // rather than manufacturing energy on the way back up to zero.
  const from = Math.max(0, prev);
  const to = Math.max(0, next);
  return to < from ? to : to - from;
}

const utcDay = (time: string) => new Date(time).toISOString().slice(0, 10);

/** Readings grouped by metric and sorted by time. Input order is not trusted. */
function byMetric(rows: readonly CounterReading[]): Map<string, CounterReading[]> {
  const groups = new Map<string, CounterReading[]>();
  for (const row of rows) {
    const list = groups.get(row.metric);
    if (list) list.push(row);
    else groups.set(row.metric, [row]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  }
  return groups;
}

/**
 * Per-metric, per-UTC-day energy, counter-aware — plus the naive `max - min`
 * for the same day, so the file records the size of the error rather than
 * asserting it in prose.
 *
 * A step is attributed to the day of its LATER reading, which is what makes a
 * reading stale across midnight behave: the increment earned overnight lands on
 * the day it was observed, exactly as `time_bucket` would place it. A day
 * therefore only appears once it has a delta to attribute; a lone reading
 * contributes nothing, which is correct rather than zero-with-a-day-row.
 */
export function perDayEnergy(rows: readonly CounterReading[]): EnergyRow[] {
  const out: EnergyRow[] = [];
  for (const [metric, list] of byMetric(rows)) {
    const days = incrementsByDay(metric, list);
    const naive = naiveByDay(list);
    for (const row of days.values()) row.naive = naive.get(row.day) ?? 0;
    out.push(...days.values());
  }
  return out.sort((a, b) => a.metric.localeCompare(b.metric) || a.day.localeCompare(b.day));
}

/** The counter-aware total, one row per day that has a step to attribute. */
function incrementsByDay(metric: string, list: readonly CounterReading[]): Map<string, EnergyRow> {
  const days = new Map<string, EnergyRow>();
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1] as CounterReading;
    const next = list[i] as CounterReading;
    const day = utcDay(next.time);
    let row = days.get(day);
    if (!row) {
      row = { metric, day, energy: 0, naive: 0, resets: 0 };
      days.set(day, row);
    }
    row.energy += counterIncrement(prev.value, next.value);
    if (next.value < prev.value) row.resets += 1;
  }
  return days;
}

/**
 * `max - min` per day: what a bucket of avg/max/min can express, and what a
 * reset makes catastrophically wrong. Recorded, not asserted away.
 */
function naiveByDay(list: readonly CounterReading[]): Map<string, number> {
  const values = new Map<string, { min: number; max: number }>();
  for (const reading of list) {
    const day = utcDay(reading.time);
    const seen = values.get(day);
    if (!seen) values.set(day, { min: reading.value, max: reading.value });
    else {
      seen.min = Math.min(seen.min, reading.value);
      seen.max = Math.max(seen.max, reading.value);
    }
  }
  return new Map([...values].map(([day, { min, max }]) => [day, max - min]));
}

/** Every point where a counter went backwards, with the naive error it causes. */
export function describeRestarts(rows: readonly CounterReading[]): RestartRow[] {
  const out: RestartRow[] = [];
  for (const [metric, list] of byMetric(rows)) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1] as CounterReading;
      const next = list[i] as CounterReading;
      if (next.value < prev.value) {
        out.push({
          metric,
          at: new Date(next.time).toISOString(),
          valueBefore: prev.value,
          valueAfter: next.value,
        });
      }
    }
  }
  return out.sort((a, b) => a.metric.localeCompare(b.metric) || a.at.localeCompare(b.at));
}

const TIERS: readonly TierName[] = ["minute_rollups", "hourly_rollups", "daily_rollups"];

/** Bucket timestamps round-trip through JSON as text; energy does not. */
const ENERGY_EPSILON = 1e-6;

const energyKey = (row: EnergyRow) => `${row.metric}|${row.day}`;

/**
 * Compare two ground truths — the fixture before the migration and whatever the
 * migration produced.
 *
 * Deliberately thin: the bucket-for-bucket, table-for-table, policy-for-policy
 * comparison already exists in `db-parity.ts` and is delegated to whenever both
 * sides carry a snapshot. What is added here is what a restore comparison has no
 * concept of — per-tier windows, the raw window, and the energy arithmetic that
 * the schema change is *for*.
 */
export function compareGroundTruth(
  before: GroundTruth,
  after: GroundTruth,
  options: { requireData?: boolean } = {},
): string[] {
  return [
    ...compareTiers(before, after),
    ...compareRawWindow(before, after),
    ...compareEnergy(before, after),
    ...compareRestarts(before, after),
    // `requireData` is deliberately NOT forwarded: the snapshot's rollup arrays
    // are empty by design (see PARITY_SQL), and compareSnapshots would read that
    // as "parity over nothing". The tier digests and the check below carry it.
    ...(before.snapshot && after.snapshot
      ? compareSnapshots(before.snapshot, after.snapshot, { expectRawLoss: false })
      : []),
    ...(options.requireData ? checkFixtureIsMeaningful(before) : []),
  ];
}

function compareTiers(before: GroundTruth, after: GroundTruth): string[] {
  return TIERS.flatMap((tier) => compareTier(tier, before.tiers[tier], after.tiers[tier]));
}

/**
 * One tier. An absent tier AFTER is the finding; an absent tier BEFORE has
 * nothing to compare — a 1.2.0 snapshot legitimately predates a tier the
 * migration adds.
 */
function compareTier(
  tier: TierName,
  a: TierSummary | undefined,
  b: TierSummary | undefined,
): string[] {
  if (!b) return [`${tier}: tier missing after`];
  if (!a) return [];
  const problems: string[] = [];
  if (a.count !== b.count) problems.push(`${tier}: ${a.count} buckets before, ${b.count} after`);
  for (const field of ["minBucket", "maxBucket"] as const) {
    if (a[field] !== b[field]) {
      problems.push(`${tier}: ${field} ${a[field]} before, ${b[field]} after`);
    }
  }
  if (a.digest !== null && b.digest !== null && a.digest !== b.digest) {
    problems.push(`${tier}: bucket digest ${a.digest} before, ${b.digest} after`);
  }
  return problems;
}

function compareRawWindow(before: GroundTruth, after: GroundTruth): string[] {
  const problems: string[] = [];
  if (before.raw.count !== after.raw.count) {
    problems.push(`metrics_raw: ${before.raw.count} rows before, ${after.raw.count} after`);
  }
  if (before.raw.minTime !== after.raw.minTime || before.raw.maxTime !== after.raw.maxTime) {
    problems.push(
      `metrics_raw: window ${before.raw.minTime}..${before.raw.maxTime} before, ` +
        `${after.raw.minTime}..${after.raw.maxTime} after`,
    );
  }
  return problems;
}

/** The arithmetic the schema change exists for, per metric and per day. */
function compareEnergy(before: GroundTruth, after: GroundTruth): string[] {
  const problems: string[] = [];
  const remaining = new Map(after.perMetricPerDayEnergy.map((r) => [energyKey(r), r]));
  for (const row of before.perMetricPerDayEnergy) {
    const other = remaining.get(energyKey(row));
    if (!other) {
      problems.push(`energy: ${row.metric} ${row.day}: missing after`);
      continue;
    }
    if (Math.abs(row.energy - other.energy) > ENERGY_EPSILON) {
      problems.push(
        `energy: ${row.metric} ${row.day}: ${row.energy} before, ${other.energy} after`,
      );
    }
    remaining.delete(energyKey(row));
  }
  for (const key of remaining.keys()) problems.push(`energy: ${key}: appeared after, unexpected`);
  return problems;
}

function compareRestarts(before: GroundTruth, after: GroundTruth): string[] {
  if (before.restarts.length === after.restarts.length) return [];
  return [
    `counter restarts: ${before.restarts.length} before, ${after.restarts.length} after — ` +
      `the reset case is the one the new schema exists to get right`,
  ];
}

/** Guard against a green comparison over an empty or toothless fixture. */
function checkFixtureIsMeaningful(before: GroundTruth): string[] {
  const problems: string[] = [];
  if (TIERS.every((tier) => (before.tiers[tier]?.count ?? 0) === 0)) {
    problems.push("fixture has no rollup buckets — a comparison over nothing proves nothing");
  }
  if (before.restarts.length === 0) {
    problems.push("fixture contains no counter restart — the headline case is unseeded");
  }
  if (before.snapshot && before.snapshot.compressedChunks === 0) {
    problems.push("fixture has no compressed chunk — the riskiest case is untested");
  }
  return problems;
}

/**
 * What this fixture is, stamped into the ground-truth file so nobody downstream
 * has to guess how much it proves.
 */
export const PROVENANCE = {
  kind: "synthetic-but-schema-exact",
  schemaSource:
    "git tag addon-v1.2.0 (packages/db/src/migrations + src/timescale), replayed verbatim",
  dataSource: "generated by scripts/fixture-1-2-0.ts — NOT a dump of the production instance",
  proves:
    "that the migration's DDL, its backfill arithmetic and its handling of the " +
    "raw-trimmed / minute-only-history state are correct against the real 1.2.0 schema",
  doesNotProve:
    "anything about production's actual row values, its data volume, hand-edited or " +
    "drifted schema objects, or rows written by versions older than 1.2.0",
} as const;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type CliAction = "build" | "snapshot" | "restore" | "ground-truth" | "help";

export type CliOptions = {
  action: CliAction;
  mode: FixtureMode;
  reset: boolean;
  /**
   * Pins the end of the seeded span. `null` means "the current whole minute",
   * which is what a rehearsal wants; a fixed value is what makes a rebuild
   * byte-reproducible, so two builds — or a build and a CI build — produce the
   * same ground truth and can actually be compared.
   */
  endsAt: Date | null;
};

export const HELP = `fixture-1-2-0.ts — build the addon-1.2.0 rehearsal database

  bun scripts/fixture-1-2-0.ts [--fast] [--reset] [--snapshot|--restore|--ground-truth]

Brings up a THROWAWAY TimescaleDB (${FIXTURE_IMAGE}) on port ${FIXTURE_PORT} with
--network host, applies the addon-v1.2.0 schema recovered from git, seeds history,
materializes all three continuous aggregates over the whole span, compresses, then
drops raw chunks older than 7 days so the result matches production 1.2.0 state.

Port ${DEV_DB_PORT} is the dev database, shared with a live inverter, and is refused.

Modes
  (default)        FULL rehearsal: 60 days, every metric in the profile, ~9.3M raw
                   rows. This is the one to migrate against for real. Minutes, not
                   seconds — see the timing note printed at the end.
  --fast           CI fixture: 10 days, ${FAST_METRIC_KEYS.length} metrics. Same schema, same shapes,
                   same counter-restart case, small enough to build in a test.

Actions
  (default)        build: drop and rebuild the fixture from scratch, then record
                   ground truth. Re-running is the reset — it is idempotent.
  --reset          also destroy and recreate the container, not just the database.
  --snapshot       pg_dump the built fixture to a file, for repeat restores.
  --restore        restore that snapshot, discarding whatever the database holds.
  --ground-truth   re-record ground truth from the existing database only.

Reproducibility
  --ends-at=<iso>  pin the end of the span (whole minute, e.g.
                   --ends-at=2026-08-01T00:00:00Z). Without it the span ends at
                   the current minute, so every rebuild produces different
                   timestamps and two ground truths cannot be compared. Pin it
                   in CI; leave it off for a rehearsal.

Ground truth is written to ${"scripts/fixtures/ground-truth-1-2-0.<mode>.json"}:
per-tier bucket windows and counts, the raw window, per-metric per-day energy
(counter-aware AND naive max-minus-min), every counter restart, and the
db-parity.ts snapshot so the existing differ covers tables and policies.
`;

const KNOWN_FLAGS = new Map<string, (o: CliOptions) => void>([
  ["--fast", (o) => (o.mode = "fast")],
  ["--full", (o) => (o.mode = "full")],
  ["--reset", (o) => (o.reset = true)],
  ["--snapshot", (o) => (o.action = "snapshot")],
  ["--restore", (o) => (o.action = "restore")],
  ["--ground-truth", (o) => (o.action = "ground-truth")],
  ["--help", (o) => (o.action = "help")],
  ["-h", (o) => (o.action = "help")],
]);

/**
 * Parse `--ends-at=<iso>`.
 *
 * Refuses anything it cannot parse rather than letting an `Invalid Date` reach
 * `generate_series`, and refuses a value with seconds: the cadence is one row
 * per minute, and a span ending mid-minute leaves every bucket boundary offset
 * from the data by a fraction of a bucket.
 */
function parseEndsAt(value: string): Date {
  const parsed = new Date(value);
  if (value.length === 0 || Number.isNaN(parsed.getTime())) {
    throw new Error(`--ends-at: cannot parse "${value}" — expected an ISO instant`);
  }
  if (parsed.getUTCSeconds() !== 0 || parsed.getUTCMilliseconds() !== 0) {
    throw new Error(`--ends-at: ${value} is not a whole minute`);
  }
  return parsed;
}

/** Unknown flags are rejected: a typo'd `--ful` must not silently mean full. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { action: "build", mode: "full", reset: false, endsAt: null };
  for (const arg of argv) {
    if (arg.startsWith("--ends-at=")) {
      options.endsAt = parseEndsAt(arg.slice("--ends-at=".length));
      continue;
    }
    const apply = KNOWN_FLAGS.get(arg);
    if (!apply) throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
    apply(options);
  }
  return options;
}

/**
 * `final` is the state the migration starts from and is verified against.
 * `pre-trim` is kept beside it because it is the only record of what the full
 * span held before raw retention took it away — the numbers the rollups are
 * supposed to still be able to reproduce. `recheck` is where an ad-hoc
 * `--ground-truth` run writes, so re-reading a built fixture can never overwrite
 * either of the two records the build produced.
 */
export type GroundTruthStage = "final" | "pre-trim" | "recheck";

export const groundTruthPath = (mode: FixtureMode, stage: GroundTruthStage = "final") =>
  join(
    import.meta.dir,
    "fixtures",
    `ground-truth-1-2-0.${mode}${stage === "final" ? "" : `.${stage}`}.json`,
  );

export const paritySnapshotPath = (mode: FixtureMode, stage: GroundTruthStage = "final") =>
  join(import.meta.dir, "fixtures", `parity-1-2-0.${mode}.${stage}.json`);

/**
 * Write the committed ground truth, and the bulky `db-parity.ts` snapshot beside
 * it as a build artifact.
 *
 * They are split because they have different lifetimes. The summaries are the
 * record — small, reviewable in a diff, and the thing a migration is checked
 * against months from now. The per-bucket snapshot is 30 MB for the 10-day fast
 * fixture alone and would be gigabytes for the full span, so it is regenerated
 * per run and gitignored; `compareSnapshots` still gets it when both sides of a
 * comparison have one.
 */
export function writeGroundTruth(
  mode: FixtureMode,
  truth: GroundTruth,
  stage: GroundTruthStage = "final",
  io: FixtureIo = productionIo,
): string {
  const path = groundTruthPath(mode, stage);
  const { snapshot, ...summaries } = truth;
  io.writeFile(path, `${JSON.stringify({ provenance: PROVENANCE, ...summaries }, null, 2)}\n`);
  if (snapshot) {
    io.writeFile(paritySnapshotPath(mode, stage), `${JSON.stringify(snapshot)}\n`);
  }
  return path;
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// ---------------------------------------------------------------------------
// Runtime: container, schema-from-git, seeding, ground truth
//
// Everything below talks to Docker or Postgres, so it is proved by running it
// (`--fast` end to end) rather than by a unit test. Every piece of arithmetic it
// depends on lives above this line and is unit-tested there.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");

/**
 * Everything the runtime half reaches the outside world through: Docker, the
 * fixture's Postgres, git, the clock and the filesystem.
 *
 * Injected — with the production wiring as the default, so every caller passes
 * nothing and the script behaves exactly as before — in the same shape as the
 * `FloorIo` seam in `scripts/coverage-floor.ts`.
 *
 * The split is deliberate: each method below holds ONE command, verbatim, and
 * nothing else. What a command *is* cannot be proved by a unit test (only by
 * running the fixture), so it is isolated where a test never has to look at it.
 * Which command runs *when* — the reset branch, the readiness retry giving up,
 * a `pg_restore` exit code that must not be reported as success, the trim cutoff
 * — is a decision, and every one of those is proved against a fake below.
 */
/**
 * One Docker invocation the fixture makes.
 *
 * A union rather than eight methods so that EVERY shell command in this script
 * lives in exactly one function ({@link productionIo.docker}) — the one thing a
 * unit test can never execute, because `docker rm -f` and `pg_dump` act on the
 * real fixture container and even a read-only `docker ps` fails wherever Docker
 * is absent. Which command runs when stays out here, where it is provable.
 */
export type DockerCommand =
  /** `docker ps -a` — the container's state, or "" when it does not exist. */
  | { kind: "state" }
  /** `pg_isready` inside the container. */
  | { kind: "ready" }
  | { kind: "remove" }
  | { kind: "create" }
  | { kind: "start" }
  /** `pg_dump` to {@link SNAPSHOT_IN_CONTAINER}. */
  | { kind: "dump" }
  /** `pg_restore` from {@link SNAPSHOT_IN_CONTAINER}. */
  | { kind: "restore" }
  | { kind: "psql"; sql: string };

export interface FixtureIo {
  /** Run one Docker command; its stdout and exit code. */
  docker(command: DockerCommand): Promise<{ stdout: string; exitCode: number }>;
  /** `git show <SCHEMA_TAG>:<path>` — the schema, recovered never transcribed. */
  gitShow(path: string): Promise<string>;
  /** A connection pool for `url`. */
  connect(url: string): SQL;
  /** A single-connection pool for the `postgres` maintenance database. */
  connectAdmin(url: string): SQL;
  sleep(ms: number): Promise<void>;
  /** The profile JSON this fixture's identity comes from, as text. */
  readProfile(): Promise<string>;
  /** Write `content` to `path`, creating the directory. */
  writeFile(path: string, content: string): void;
  log(message: string): void;
  error(message: string): void;
}

/** The tag the fixture's schema is recovered from. Never a hand-written copy. */
export const SCHEMA_TAG = "addon-v1.2.0";

/** Applied in this order: drizzle tables first, then the TimescaleDB objects. */
const DRIZZLE_FILES = [
  "packages/db/src/migrations/0000_brief_cammi.sql",
  "packages/db/src/migrations/0001_magenta_the_initiative.sql",
] as const;
const TIMESCALE_FILES = [
  "packages/db/src/timescale/0000_bootstrap.sql",
  "packages/db/src/timescale/policies.sql",
] as const;
const JOURNAL_FILE = "packages/db/src/migrations/meta/_journal.json";

/**
 * The profile the fixture's identity and metric list come from. 1.2.0 stamps
 * `inverterId = profile.id` (see `packages/inverter-core/src/driver.ts`), so the
 * fixture's single inverter id is a real profile id, not an invented string.
 */
const PROFILE_FILE = "packages/profile-sdk/src/__fixtures__/sample-profile.json";

/** Where snapshots live INSIDE the container, so no host pg_dump is needed. */
const SNAPSHOT_IN_CONTAINER = "/var/lib/postgresql/fixture-1-2-0.dump";

/**
 * The real wiring. Every shell command in the fixture lives here and nowhere
 * else, exactly as it was written; `--network host` because bridged containers
 * do not work in this LXC, which is also why the port has to be moved with
 * `-c port=` instead of `-p`: with host networking there is no port mapping to
 * hide behind, and the default 5432 is the dev database.
 */
export const productionIo: FixtureIo = {
  async docker(command) {
    const run = async (shell: PromiseLike<{ stdout: Buffer; exitCode: number | null }>) => {
      const result = await shell;
      return { stdout: result.stdout.toString(), exitCode: result.exitCode ?? 0 };
    };
    switch (command.kind) {
      case "state":
        return run(
          $`docker ps -a --filter name=^${FIXTURE_CONTAINER}$ --format {{.State}}`.quiet(),
        );
      case "ready":
        return run(
          $`docker exec ${FIXTURE_CONTAINER} pg_isready -h 127.0.0.1 -p ${FIXTURE_PORT} -U postgres`
            .quiet()
            .nothrow(),
        );
      case "remove":
        return run($`docker rm -f ${FIXTURE_CONTAINER}`.quiet());
      case "create":
        return run(
          $`docker run -d --name ${FIXTURE_CONTAINER} --network host \
      -e POSTGRES_PASSWORD=${FIXTURE_PASSWORD} -e POSTGRES_DB=postgres -e PGPORT=${FIXTURE_PORT} \
      -e TIMESCALEDB_TELEMETRY=off \
      ${FIXTURE_IMAGE} \
      -c port=${FIXTURE_PORT} -c max_wal_size=8GB -c checkpoint_timeout=30min \
      -c synchronous_commit=off -c timescaledb.telemetry_level=off`.quiet(),
        );
      case "start":
        return run($`docker start ${FIXTURE_CONTAINER}`.quiet());
      case "dump":
        return run(
          $`docker exec ${FIXTURE_CONTAINER} pg_dump -U postgres -p ${FIXTURE_PORT} \
    -d ${FIXTURE_DB} -Fc -f ${SNAPSHOT_IN_CONTAINER}`,
        );
      case "restore":
        return run(
          $`docker exec ${FIXTURE_CONTAINER} pg_restore -U postgres -p ${FIXTURE_PORT} -d ${FIXTURE_DB} --no-owner ${SNAPSHOT_IN_CONTAINER}`.nothrow(),
        );
      case "psql":
        return run(
          $`docker exec ${FIXTURE_CONTAINER} psql -X -q -U postgres -p ${FIXTURE_PORT} -d ${FIXTURE_DB} -c ${command.sql}`.quiet(),
        );
    }
  },
  gitShow: (path) => $`git -C ${REPO_ROOT} show ${SCHEMA_TAG}:${path}`.text(),
  connect: (url) => new SQL(url, { max: 1, idleTimeout: 0 }),
  connectAdmin: (url) => new SQL(url, { max: 1 }),
  sleep: (ms) => Bun.sleep(ms),
  readProfile: () => Bun.file(join(REPO_ROOT, PROFILE_FILE)).text(),
  writeFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
  log: (message) => console.log(`[fixture] ${message}`),
  error: (message) => console.error(message),
};

/**
 * Split a SQL file on drizzle's breakpoint marker. Continuous aggregates cannot
 * be created inside a transaction block, which is exactly why the real runner
 * splits here too — one statement per round trip, never a batch.
 */
export function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !/^(--[^\n]*\n?)+$/.test(chunk));
}

/**
 * Which of the three states the container is in.
 *
 * `docker ps -a` prints nothing at all for a container that does not exist, and
 * that is the case the reset branch below must not try to remove.
 *
 * @internal Exported for `fixture-1-2-0.test.ts`.
 */
export async function containerState(
  io: FixtureIo = productionIo,
): Promise<"absent" | "stopped" | "running"> {
  const out = (await io.docker({ kind: "state" })).stdout.trim();
  if (out.length === 0) return "absent";
  return out.startsWith("running") ? "running" : "stopped";
}

/**
 * Wait for the server to accept connections, or give up loudly.
 *
 * A minute of retries is a starting Postgres; sixty seconds of them is a
 * container that will never come up, and hanging forever on it would look
 * exactly like a slow fixture build.
 *
 * @internal Exported for `fixture-1-2-0.test.ts`.
 */
export async function waitReady(io: FixtureIo = productionIo): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await io.docker({ kind: "ready" })).exitCode === 0) return;
    await io.sleep(500);
  }
  throw new Error(`${FIXTURE_CONTAINER} never became ready on port ${FIXTURE_PORT}`);
}

/**
 * Bring up the throwaway server.
 *
 * `--network host` because bridged containers do not work in this LXC, which is
 * also why the port has to be moved with `-c port=` instead of `-p`: with host
 * networking there is no port mapping to hide behind, and the default 5432 is
 * the dev database.
 */
export async function ensureContainer(reset: boolean, io: FixtureIo = productionIo): Promise<void> {
  let state = await containerState(io);
  if (reset && state !== "absent") {
    io.log(`removing container ${FIXTURE_CONTAINER}`);
    await io.docker({ kind: "remove" });
    state = "absent";
  }
  if (state === "absent") {
    io.log(`starting ${FIXTURE_IMAGE} on port ${FIXTURE_PORT}`);
    await io.docker({ kind: "create" });
  } else if (state === "stopped") {
    io.log(`starting existing container ${FIXTURE_CONTAINER}`);
    await io.docker({ kind: "start" });
  }
  await waitReady(io);
}

/**
 * Recreate the fixture database itself. This is what makes a re-run a reset.
 *
 * @internal Exported for `fixture-1-2-0.test.ts`: this is the one function that
 * DROPs, so which database it names is worth proving.
 */
export async function recreateDatabase(io: FixtureIo = productionIo): Promise<void> {
  const admin = io.connectAdmin(adminUrl());
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${FIXTURE_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${FIXTURE_DB}`);
  } finally {
    await admin.end();
  }
  io.log(`recreated database ${FIXTURE_DB}`);
}

/**
 * Replay the tag's SQL, statement by statement, in the runner's own order.
 *
 * @internal Exported for `fixture-1-2-0.test.ts`.
 */
export async function applySchema(db: SQL, io: FixtureIo = productionIo): Promise<void> {
  for (const file of [...DRIZZLE_FILES, ...TIMESCALE_FILES]) {
    const sql = await io.gitShow(file);
    const parts = statements(sql);
    for (const statement of parts) await db.unsafe(statement);
    io.log(`applied ${SCHEMA_TAG}:${file} (${parts.length} statements)`);
  }
}

/**
 * Stamp both journals the way a real 1.2.0 instance has them stamped.
 *
 * Without this the fixture looks like a database that was never migrated, and
 * the 2.0.0 migration's own downgrade guard and `db-restore.sh`'s journal
 * refusal would take a different branch here than they will in production —
 * which is the one thing this fixture exists to get right.
 */
export async function stampJournals(db: SQL, io: FixtureIo = productionIo): Promise<void> {
  const journal = JSON.parse(await io.gitShow(JOURNAL_FILE)) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  await db.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.unsafe(
    `CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  for (const entry of journal.entries) {
    const file = `packages/db/src/migrations/${entry.tag}.sql`;
    await db.unsafe(
      `INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
      [sha256(await io.gitShow(file)), entry.when],
    );
  }
  await db.unsafe(
    `CREATE TABLE IF NOT EXISTS public.timescale_migrations (
       name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const bootstrap = "0000_bootstrap.sql";
  await db.unsafe(
    `INSERT INTO public.timescale_migrations (name, hash) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [bootstrap, sha256(await io.gitShow(`packages/db/src/timescale/${bootstrap}`))],
  );
  io.log(`stamped ${journal.entries.length} drizzle migrations and the timescale bootstrap`);
}

/**
 * The side tables. Small, but they are the irreplaceable ones — a migration that
 * loses `app_settings` loses the user's tariffs and every configured chart — and
 * `db-parity.ts` digests them, so they must not be empty.
 */
export async function seedSideTables(
  db: SQL,
  plan: FixturePlan,
  profile: unknown,
  io: FixtureIo = productionIo,
): Promise<void> {
  await db.unsafe(
    `INSERT INTO "user" (id, name, email, email_verified, role, updated_at)
     VALUES ('fixture-owner', 'Fixture Owner', 'owner@fixture.invalid', true, 'admin', now())`,
  );
  const settings: [string, unknown][] = [
    ["inverter.connection", { host: "192.168.1.50", port: 502, unitId: 1 }],
    ["inverter.profile", plan.inverterId],
    ["display", { timeZone: "Europe/Berlin", locale: "de-DE" }],
    ["plant", { timeZone: "Europe/Berlin", peakPowerW: 9600 }],
    ["tariff", { kind: "fixed", importCentsPerKwh: 34.2, exportCentsPerKwh: 8.2 }],
    ["backup", { enabled: true, backup_full: false }],
  ];
  for (const [key, value] of settings) {
    await db.unsafe(`INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)`, [
      key,
      JSON.stringify(value),
    ]);
  }
  await db.unsafe(
    `INSERT INTO installed_profiles (id, source, version, data) VALUES ($1, 'repo', $2, $3::jsonb)`,
    [plan.inverterId, (profile as { version: string }).version, JSON.stringify(profile)],
  );
  await db.unsafe(`INSERT INTO custom_charts (id, name, data) VALUES ($1, $2, $3::jsonb)`, [
    "fixture-chart",
    "PV vs battery",
    JSON.stringify({ series: ["dc.pv1.power", "battery.power"], kind: "line" }),
  ]);
  io.log(`seeded side tables (1 user, ${settings.length} settings, 1 profile, 1 chart)`);
}

/**
 * One `generate_series` INSERT per metric.
 *
 * Row by row from TypeScript would be ~9.3 M round trips; this is ~105 of them.
 * `s.m` is float minutes since the span start and `s.mi` the same as bigint —
 * both are needed because Postgres has `mod` and integer division for bigint and
 * the trigonometric functions for float8, and no overlap.
 */
export async function seedMetrics(
  db: SQL,
  plan: FixturePlan,
  io: FixtureIo = productionIo,
): Promise<void> {
  const start = plan.startsAt.toISOString();
  const end = plan.endsAt.toISOString();
  const began = Date.now();
  for (const metric of plan.metrics) {
    await db.unsafe(
      `INSERT INTO metrics_raw (time, inverter_id, metric, value)
       SELECT s.ts, $1, $2, (${sqlValueExpr(metric.shape)})
       FROM (
         SELECT ts,
                (extract(epoch from (ts - $3::timestamptz)) / 60)::double precision AS m,
                (extract(epoch from (ts - $3::timestamptz)) / 60)::bigint AS mi
         FROM generate_series($3::timestamptz, $4::timestamptz - interval '1 minute',
                              interval '1 minute') AS ts
       ) s`,
      [plan.inverterId, metric.key, start, end],
    );
  }
  const seconds = ((Date.now() - began) / 1000).toFixed(1);
  io.log(`seeded ${planRowCount(plan).toLocaleString("en-US")} raw rows in ${seconds}s`);
}

/**
 * Execute the SQL side of the value model against the TypeScript side.
 *
 * The two expressions of the arithmetic are the one place this fixture could be
 * quietly wrong — a fixture whose values are not what the ground truth says they
 * are proves the opposite of what it claims. So a sample of seeded rows is read
 * back and compared to {@link valueAt}. A mismatch fails the build.
 */
export async function verifyModel(
  db: SQL,
  plan: FixturePlan,
  io: FixtureIo = productionIo,
): Promise<void> {
  const totalMinutes = plan.spanDays * MINUTES_PER_DAY;
  let checked = 0;
  for (const metric of plan.metrics) {
    for (const fraction of [0, 0.13, 0.5, 0.77, 0.999]) {
      const minute = Math.min(totalMinutes - 1, Math.floor(totalMinutes * fraction));
      const rows = (await db.unsafe(
        `SELECT value FROM metrics_raw
         WHERE metric = $1 AND time = $2::timestamptz + ($3 || ' minutes')::interval`,
        [metric.key, plan.startsAt.toISOString(), String(minute)],
      )) as { value: number }[];
      const actual = rows[0]?.value;
      if (actual === undefined) {
        throw new Error(`model check: no seeded row for ${metric.key} at minute ${minute}`);
      }
      const expected = valueAt(metric.shape, minute);
      if (Math.abs(actual - expected) > 1e-6 * Math.max(1, Math.abs(expected))) {
        throw new Error(
          `model check: ${metric.key} minute ${minute}: SQL produced ${actual}, ` +
            `valueAt() says ${expected} — the two expressions of the value model have drifted`,
        );
      }
      checked += 1;
    }
  }
  io.log(`value model verified: ${checked} sampled rows match valueAt() exactly`);
}

/**
 * Materialize all three aggregates over the WHOLE span.
 *
 * The refresh *policies* installed by policies.sql have `start_offset` of 10
 * minutes / 3 hours / 3 days, so they would never reach seeded history no matter
 * how long the container ran. Only an explicit
 * `refresh_continuous_aggregate` over the full window reproduces the state a
 * real instance reached by running continuously for two months.
 */
export async function materialize(
  db: SQL,
  plan: FixturePlan,
  io: FixtureIo = productionIo,
): Promise<void> {
  const from = new Date(plan.startsAt.getTime() - 86_400_000).toISOString();
  const to = new Date(plan.endsAt.getTime() + 86_400_000).toISOString();
  for (const tier of TIERS) {
    const began = Date.now();
    await db.unsafe(
      `CALL refresh_continuous_aggregate('${tier}', '${from}'::timestamptz, '${to}'::timestamptz)`,
    );
    io.log(`materialized ${tier} in ${((Date.now() - began) / 1000).toFixed(1)}s`);
  }
}

/**
 * Compress what production has compressed. `db-parity.ts` treats a fixture with
 * no compressed chunk as untested for a reason: writing back a compressed chunk
 * is the case most likely to break, and the policies would not have run yet.
 */
export async function compress(
  db: SQL,
  plan: FixturePlan,
  io: FixtureIo = productionIo,
): Promise<void> {
  const rawCutoff = new Date(plan.endsAt.getTime() - 86_400_000).toISOString();
  const minuteCutoff = new Date(plan.endsAt.getTime() - 7 * 86_400_000).toISOString();
  for (const [table, cutoff] of [
    ["metrics_raw", rawCutoff],
    ["minute_rollups", minuteCutoff],
  ] as const) {
    const result = await db
      .unsafe(
        `SELECT count(compress_chunk(c, if_not_compressed => true)) AS n
         FROM show_chunks('${table}', older_than => '${cutoff}'::timestamptz) c`,
      )
      .catch((error: unknown) => {
        // A tier with no chunk old enough is not a failure — in --fast mode
        // minute_rollups has nothing older than 7 days by construction.
        io.log(`compress ${table}: skipped (${(error as Error).message})`);
        return [{ n: 0 }];
      });
    io.log(`compressed ${(result as { n: number }[])[0]?.n ?? 0} chunk(s) of ${table}`);
  }
}

/**
 * Drop raw chunks older than the 7-day retention, reproducing the state
 * production is actually in.
 *
 * `drop_chunks`, never `DELETE`: a DELETE against compressed chunks silently
 * aborts past ~100k tuples, and it is also not what retention does — the
 * migration must face whole missing chunks, not a table with holes.
 */
export async function trimRaw(
  db: SQL,
  plan: FixturePlan,
  io: FixtureIo = productionIo,
): Promise<void> {
  const cutoff = new Date(plan.endsAt.getTime() - 7 * 86_400_000).toISOString();
  const dropped = (await db.unsafe(
    `SELECT count(*) AS n FROM drop_chunks('metrics_raw', older_than => '${cutoff}'::timestamptz)`,
  )) as { n: number }[];
  io.log(`dropped ${dropped[0]?.n ?? 0} raw chunk(s) older than ${cutoff} (7-day retention)`);
}

const counterMetrics = (plan: FixturePlan) =>
  plan.metrics.filter((m) => m.shape.kind === "counter");

/**
 * Per-metric per-day energy, computed by the unit-tested {@link perDayEnergy}
 * rather than by a second SQL implementation — one query per counter metric so
 * the readings stream in bounded chunks instead of one 1.1 M-row result.
 */
export async function readEnergy(
  db: SQL,
  plan: FixturePlan,
): Promise<{ energy: EnergyRow[]; restarts: RestartRow[] }> {
  const energy: EnergyRow[] = [];
  const restarts: RestartRow[] = [];
  for (const metric of counterMetrics(plan)) {
    const rows = (await db.unsafe(
      `SELECT time, value FROM metrics_raw WHERE metric = $1 ORDER BY time`,
      [metric.key],
    )) as { time: Date | string; value: number }[];
    const readings: CounterReading[] = rows.map((r) => ({
      metric: metric.key,
      time: new Date(r.time).toISOString(),
      value: r.value,
    }));
    energy.push(...perDayEnergy(readings));
    restarts.push(...describeRestarts(readings));
  }
  return { energy, restarts };
}

/** Tier windows, the raw window, and the db-parity snapshot. */
export async function readState(db: SQL): Promise<Pick<GroundTruth, "tiers" | "raw" | "snapshot">> {
  const tiers = {} as Record<TierName, TierSummary>;
  for (const tier of TIERS) tiers[tier] = await readTier(db, tier);
  const snapshot = await readParitySnapshot(db);
  return { tiers, raw: await readRawWindow(db), ...(snapshot ? { snapshot } : {}) };
}

export async function readTier(db: SQL, tier: TierName): Promise<TierSummary> {
  const rows = (await db.unsafe(
    `SELECT min(bucket)::text AS "minBucket", max(bucket)::text AS "maxBucket",
            count(*)::bigint AS count,
            md5(coalesce(string_agg(
              bucket::text || '|' || inverter_id || '|' || metric || '|' ||
              coalesce(avg_value::text, '') || '|' || coalesce(max_value::text, '') || '|' ||
              coalesce(min_value::text, ''), ',' ORDER BY bucket, inverter_id, metric), '')) AS digest
     FROM ${tier}`,
  )) as {
    minBucket: string | null;
    maxBucket: string | null;
    count: number | string;
    digest: string | null;
  }[];
  const row = rows[0];
  return {
    minBucket: row?.minBucket ?? null,
    maxBucket: row?.maxBucket ?? null,
    count: Number(row?.count ?? 0),
    digest: row?.digest ?? null,
  };
}

export async function readRawWindow(db: SQL): Promise<GroundTruth["raw"]> {
  const rows = (await db.unsafe(
    `SELECT min(time)::text AS "minTime", max(time)::text AS "maxTime",
            count(*)::bigint AS count FROM metrics_raw`,
  )) as { minTime: string | null; maxTime: string | null; count: number | string }[];
  const row = rows[0];
  return {
    minTime: row?.minTime ?? null,
    maxTime: row?.maxTime ?? null,
    count: Number(row?.count ?? 0),
  };
}

/**
 * The cheap half of the db-parity snapshot: side tables, policies, chunk counts.
 *
 * `includeRollups: false` is not an optimization, it is the difference between
 * working and not: at 60 days x 105 metrics the rollup arrays are 9.07 M rows
 * and aggregating them into one JSON value dies with "out of memory". Bucket
 * integrity is covered by {@link TierSummary.digest} instead.
 */
const PARITY_SQL = buildSnapshotSql({ includeRollups: false });

/** One `json_build_object`, unwrapped from whatever column name it lands in. */
export async function readParitySnapshot(db: SQL): Promise<Snapshot | undefined> {
  const rows = (await db.unsafe(PARITY_SQL)) as Record<string, unknown>[];
  return Object.values(rows[0] ?? {})[0] as Snapshot | undefined;
}

export async function recordGroundTruth(
  db: SQL,
  plan: FixturePlan,
  energy: { energy: EnergyRow[]; restarts: RestartRow[] },
): Promise<GroundTruth> {
  const state = await readState(db);
  return {
    generatedAt: new Date().toISOString(),
    fixture: {
      mode: plan.mode,
      inverterId: plan.inverterId,
      spanDays: plan.spanDays,
      cadenceSeconds: plan.cadenceSeconds,
      metricCount: plan.metrics.length,
      rawRetentionDays: 7,
    },
    ...state,
    perMetricPerDayEnergy: energy.energy,
    restarts: energy.restarts,
  };
}

/**
 * A short human summary, so a run reports its own numbers rather than "done".
 *
 * The last line is the one that matters: the worst per-day gap between the
 * counter-aware energy and the naive `max - min`. A fixture where that line is
 * absent has no reset to trip over, and a migration could keep the naive
 * arithmetic and still look correct against it.
 *
 * @internal Exported for `fixture-1-2-0.test.ts`.
 */
export function report(truth: GroundTruth, io: FixtureIo = productionIo): void {
  for (const tier of TIERS) {
    const t = truth.tiers[tier];
    io.log(`${tier}: ${t.count.toLocaleString("en-US")} buckets, ${t.minBucket} .. ${t.maxBucket}`);
  }
  io.log(
    `metrics_raw: ${truth.raw.count.toLocaleString("en-US")} rows, ` +
      `${truth.raw.minTime} .. ${truth.raw.maxTime}`,
  );
  io.log(`per-metric per-day energy rows: ${truth.perMetricPerDayEnergy.length}`);
  io.log(`counter restarts seeded: ${truth.restarts.length}`);
  const worst = truth.perMetricPerDayEnergy
    .filter((r) => r.resets > 0 && r.energy > 0)
    .sort((a, b) => b.naive / b.energy - a.naive / a.energy)[0];
  if (worst) {
    io.log(
      `worst naive error: ${worst.metric} ${worst.day}: true ${worst.energy.toFixed(3)} kWh vs ` +
        `max-min ${worst.naive.toFixed(3)} kWh (${(worst.naive / worst.energy).toFixed(0)}x)`,
    );
  }
}

export async function loadProfile(
  io: FixtureIo = productionIo,
): Promise<{ id: string; version: string; metrics: ProfileMetric[] }> {
  const profile = JSON.parse(await io.readProfile());
  return profile;
}

/**
 * The span ends on a whole minute so buckets are not half-open at the top.
 *
 * @internal Exported for `fixture-1-2-0.test.ts`.
 */
export function spanEnd(now: Date = new Date()): Date {
  const end = new Date(now.getTime());
  end.setUTCSeconds(0, 0);
  return end;
}

export async function build(options: CliOptions, io: FixtureIo = productionIo): Promise<number> {
  const profile = await loadProfile(io);
  const plan = buildPlan({
    mode: options.mode,
    endsAt: options.endsAt ?? spanEnd(),
    profileMetrics: profile.metrics.map((m) => ({ key: m.key, unit: m.unit ?? null })),
    inverterId: profile.id,
  });
  io.log(
    `${plan.mode} mode: ${plan.spanDays} days x ${plan.metrics.length} metrics = ` +
      `${planRowCount(plan).toLocaleString("en-US")} raw rows, inverter_id "${plan.inverterId}"`,
  );

  await ensureContainer(options.reset, io);
  await recreateDatabase(io);
  const url = fixtureUrl();
  assertFixtureTarget(url);
  const db = io.connect(url);
  try {
    await applySchema(db, io);
    await stampJournals(db, io);
    await seedSideTables(db, plan, profile, io);
    await seedMetrics(db, plan, io);
    await verifyModel(db, plan, io);
    await materialize(db, plan, io);
    await compress(db, plan, io);

    // Energy is read BEFORE the trim: this is the only moment the full span
    // exists in raw form, and it is the answer the migration must still be able
    // to produce from the rollups afterwards.
    const energy = await readEnergy(db, plan);
    const preTrim = await recordGroundTruth(db, plan, energy);
    writeGroundTruth(plan.mode, preTrim, "pre-trim", io);

    await trimRaw(db, plan, io);

    const final = await recordGroundTruth(db, plan, energy);
    const path = writeGroundTruth(plan.mode, final, "final", io);
    report(final, io);
    io.log(`ground truth: ${path}`);
    const problems = compareGroundTruth(final, final, { requireData: true });
    if (problems.length > 0) {
      for (const problem of problems) io.error(`  - ${problem}`);
      io.log("the fixture is not meaningful enough to rehearse against — see above");
      return 1;
    }
    io.log("fixture ready. SYNTHETIC-BUT-SCHEMA-EXACT: see the provenance block in the JSON.");
    return 0;
  } finally {
    await db.end();
  }
}

export async function snapshot(io: FixtureIo = productionIo): Promise<number> {
  await waitReady(io);
  io.log(`dumping ${FIXTURE_DB} to ${SNAPSHOT_IN_CONTAINER} (inside the container)`);
  await io.docker({ kind: "dump" });
  io.log("snapshot written. Restore it with --restore; it survives a container restart.");
  return 0;
}

/**
 * Restore the snapshot, bracketed by `timescaledb_pre_restore`/`post_restore`
 * for the same reason `scripts/db-restore.sh` does it: without them compressed
 * chunks and continuous-aggregate catalog rows cannot be written back.
 */
export async function restore(io: FixtureIo = productionIo): Promise<number> {
  await waitReady(io);
  await recreateDatabase(io);
  await io.docker({ kind: "psql", sql: "SELECT timescaledb_pre_restore();" });
  const { exitCode } = await io.docker({ kind: "restore" });
  await io.docker({ kind: "psql", sql: "SELECT timescaledb_post_restore();" });
  if (exitCode !== 0) {
    io.error(`pg_restore exited ${exitCode} — the fixture is NOT trustworthy.`);
    return exitCode;
  }
  io.log(`restored ${FIXTURE_DB} from ${SNAPSHOT_IN_CONTAINER}`);
  return 0;
}

export async function groundTruthOnly(
  mode: FixtureMode,
  endsAt: Date | null,
  io: FixtureIo = productionIo,
): Promise<number> {
  await waitReady(io);
  const profile = await loadProfile(io);
  const url = fixtureUrl();
  assertFixtureTarget(url);
  const db = io.connect(url);
  try {
    const plan = buildPlan({
      mode,
      endsAt: endsAt ?? spanEnd(),
      profileMetrics: profile.metrics.map((m) => ({ key: m.key, unit: m.unit ?? null })),
      inverterId: profile.id,
    });
    // Only the retained raw window is left, so this re-records the tier windows
    // faithfully but can only see 7 days of energy. The authoritative energy
    // numbers stay in the file the build wrote.
    const truth = await recordGroundTruth(db, plan, await readEnergy(db, plan));
    report(truth, io);
    io.log(`ground truth (raw window only): ${writeGroundTruth(mode, truth, "recheck", io)}`);
    return 0;
  } finally {
    await db.end();
  }
}

export async function main(argv: readonly string[], io: FixtureIo = productionIo): Promise<number> {
  const options = parseArgs(argv);
  switch (options.action) {
    case "help":
      console.log(HELP);
      return 0;
    case "snapshot":
      return snapshot(io);
    case "restore":
      return restore(io);
    case "ground-truth":
      return groundTruthOnly(options.mode, options.endsAt, io);
    case "build":
      return build(options, io);
  }
}

/**
 * The entry point's body, extracted so the failure path is provable: a bad flag
 * or a refused target must exit 1 with its own message, never a stack trace.
 */
export async function cli(argv: readonly string[], io: FixtureIo = productionIo): Promise<number> {
  try {
    return await main(argv, io);
  } catch (error) {
    io.error((error as Error).message);
    return 1;
  }
}

if (import.meta.main) process.exit(await cli(process.argv.slice(2)));
