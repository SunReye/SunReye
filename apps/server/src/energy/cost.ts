/**
 * Cost engine: turns stored energy flows into money using the active tariff.
 *
 * Energy comes from the hourly TimescaleDB rollups of the inverter's monotonic
 * lifetime counters (imported/exported/load/production kWh): energy in a bucket
 * is the counter's rise since the *previous* bucket (`max_value` delta), clamped
 * ≥0 so a reset costs one bucket, not the whole lifetime total. The pricing
 * arithmetic is pure
 * and unit-tested in {@link ./cost-calc}. Metrics are resolved by canonical
 * role, never vendor keys, so any profile exposing the standard energy roles
 * gets cost tracking for free.
 */

import type {
  CostBreakdown,
  CostTotals,
  EnergyField,
  EnergyTotals,
  HourEnergy,
} from "@SunReye/contracts/energy";
import { db } from "@SunReye/db";
import type { TariffConfig } from "@SunReye/db/tariff";
import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { sql } from "drizzle-orm";
import { deviceIdOf, metricIdsOf, metricKeyColumn, metricKeyJoin } from "../shared/identity-sql";
import { type ZeroValueShare, allocateCost, priceSeriesRows, rollUpToMonths } from "./cost-calc";
import { emptyTotals, impliedLoadKwh, replaceTodaySlice, withImpliedHourLoad } from "./energy-calc";
import { getPlantTimeZone } from "../settings/display-settings";
import { getTariff } from "../settings/settings";
import { liveState } from "../shared/state";
import { startOfZonedDay, zonedFields, zonedInstant } from "./zoned-time";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const HOUR_MS = 3_600_000;

/**
 * The host process zone — the back-compatible default for the period helpers
 * when no plant zone is threaded in. Read live (not cached) so tests that flip
 * `process.env.TZ` at runtime still see the change. Production paths pass the
 * configured plant zone from {@link getPlantTimeZone}; the host is only the
 * fallback for an unconfigured instance (issues #46, #52).
 */
const hostTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export { resolveRange } from "./cost-calc";

/** The energy-counter metric key for a role in this profile, if present. */
function keyForRole(p: InverterProfile, role: CanonicalRole): string | undefined {
  return p.metrics.find((m) => m.role === role)?.key;
}

/** The {@link HourEnergy} fields we price, and the role backing each. */
export const ENERGY_FIELDS = {
  import: "grid.energy.imported.total",
  export: "grid.energy.exported.total",
  load: "load.energy.total",
  production: "production.total",
  batteryDischarge: "battery.energy.discharged.total",
  batteryCharge: "battery.energy.charged.total",
} as const satisfies Record<keyof Omit<HourEnergy, "time">, CanonicalRole>;

/** How an energy figure is derived from stored data. */
type EnergyDerivation = "counter" | "integral";

/**
 * Where each energy role's kWh figure actually comes from — issue #115's answer,
 * kept next to the code it describes.
 *
 * This is not documentation. `cost.test.ts` ("energy derivation per role")
 * MEASURES the derivation from the running code and compares it against this
 * table, so flipping a role from a counter read to an integral (or back) without
 * updating the table turns the suite red.
 *
 * Why it matters: milestone 8 stores only *changes* to a metric instead of a
 * sample per poll. Thinning the raw series leaves a bucket's `max_value` /
 * `min_value` untouched (a counter's change points are exactly the samples
 * change-only storage keeps) but moves its unweighted `avg_value` and its sample
 * count a long way. So a `"counter"` figure — a difference of monotonic counter
 * readings — is invariant under thinning and the storage change is safe for it,
 * while an `"integral"` figure (Σ power·Δt over the recorded samples) moves with
 * the sample density and needs time-weighting first (issues #116 / #117).
 *
 * All six reported roles are counter-derived: {@link fetchBucketEnergy} and
 * {@link fetchCounterDeltaMatrix} read only `max_value` / `min_value`, never
 * `avg_value`, and the live current-day override ({@link liveTodayTotals}) reads
 * the device's own `*.today` registers. Nothing in this layer integrates power.
 * The one integrated energy figure in the product is the browser-side
 * reconstruction in
 * `apps/web/src/lib/components/inverter/_shared/measured-day.ts`.
 */
// fallow-ignore-next-line unused-export -- the verdict cost.test.ts measures the code against; test files aren't traced as consumers
export const ENERGY_ROLE_DERIVATION = {
  import: "counter",
  export: "counter",
  load: "counter",
  production: "counter",
  batteryDischarge: "counter",
  batteryCharge: "counter",
} as const satisfies Record<EnergyField, EnergyDerivation>;

/** The continuous-aggregate views we can read counter deltas from. */
export type RollupView = "hourly_rollups" | "daily_rollups";

/**
 * Longest hole in the record a counter delta may bridge, per view.
 *
 * A cumulative counter keeps rising while the recorder is down, so the first
 * bucket after a gap sees the whole gap's rise. Attributing it to that bucket
 * puts energy in the wrong hour, the wrong tariff band, and — when the gap
 * spans midnight or a month boundary — the wrong window entirely: a three-day
 * outage would bill Monday's kWh to Thursday lunchtime. Past this tolerance the
 * rise is unattributable, so the bucket falls back to the intra-bucket
 * `max − min` it can actually vouch for and the gap's energy is dropped.
 *
 * Short holes (a restart, a few missed polls) stay bridged: misplacing an hour
 * within the same day is a rounding error against the banding, and dropping it
 * would under-report a bill for every service restart.
 */
const MAX_GAP_MS: Record<RollupView, number> = {
  hourly_rollups: 3 * 3_600_000,
  daily_rollups: 2 * 86_400_000,
};

/** Metric key → the HourEnergy field it feeds, for the roles this profile has. */
function resolveEnergyKeys(profile: InverterProfile): Map<string, EnergyField> {
  const fieldByKey = new Map<string, EnergyField>();
  for (const [field, role] of Object.entries(ENERGY_FIELDS)) {
    const key = keyForRole(profile, role);
    if (key) fieldByKey.set(key, field as EnergyField);
  }
  return fieldByKey;
}

/**
 * The live `*.today` register roles — the current-day twins of the cumulative
 * `*.total` counters in {@link ENERGY_FIELDS}. All OPTIONAL: a profile may map
 * some, none, or all. When a twin is mapped and present in the live sample it
 * gives the in-progress day's energy directly, ahead of the coarser
 * cross-bucket `*.total` delta the rollups derive (which lags the live register
 * for the current day) — so the chart/KPIs match the dashboard headline.
 */
const ENERGY_TODAY_FIELDS = {
  import: "grid.energy.imported.today",
  export: "grid.energy.exported.today",
  load: "load.energy.today",
  production: "production.today",
  batteryDischarge: "battery.energy.discharged.today",
  batteryCharge: "battery.energy.charged.today",
} as const satisfies Record<EnergyField, CanonicalRole>;

/**
 * Whether the plant meters house consumption as energy at all.
 *
 * False for most non-hybrid installs — a grid-tied inverter reports production
 * and a meter reports grid flow, and nothing counts the house. Those plants have
 * their consumption implied from the surrounding flows
 * ({@link withImpliedHourLoad}); a plant that does meter it always keeps the
 * measured figure, including a genuine zero.
 */
export function metersLoadEnergy(profile: InverterProfile): boolean {
  // Either counter counts: a profile may map the cumulative total, the
  // current-day twin, or both. Checking only the total would overwrite a live
  // `load.energy.today` register with a derived figure.
  return (
    keyForRole(profile, ENERGY_FIELDS.load) !== undefined ||
    keyForRole(profile, ENERGY_TODAY_FIELDS.load) !== undefined
  );
}

/** {@link EnergyField} → the {@link EnergyTotals} kWh key it feeds. Shared with
 *  the energy-split accumulator in {@link ./energy}. */
export const TOTALS_KEY_BY_FIELD = {
  import: "importKwh",
  export: "exportKwh",
  load: "loadKwh",
  production: "productionKwh",
  batteryDischarge: "batteryDischargeKwh",
  batteryCharge: "batteryChargeKwh",
} as const satisfies Record<EnergyField, keyof EnergyTotals>;

/** Whether two Dates fall on the same calendar day in zone `tz`. */
function isSameLocalDay(a: Date, b: Date, tz: string = hostTimeZone()): boolean {
  const fa = zonedFields(a, tz);
  const fb = zonedFields(b, tz);
  return fa.year === fb.year && fa.month === fb.month && fa.day === fb.day;
}

/**
 * The live current-day energy totals, as a partial {@link EnergyTotals} carrying
 * only the fields safe to trust. `now` and `sample` default to the live clock and
 * the poll cache, and are injectable so the guards below are unit-testable
 * without a running poll loop (see cost.test.ts). Returns `{}` (no override)
 * unless ALL hold:
 *  - a sample exists;
 *  - `sample.inverterId` matches the query's effective `inverterId`;
 *  - the sample is from TODAY in server-local time — a stale sample carried
 *    across midnight must not override the fresh day.
 * A field is included only when its `*.today` twin role is mapped by the profile
 * AND the sample carries a finite value for that role's metric key; every other
 * field is left to the caller's `*.total`-delta value.
 */
export function liveTodayTotals(
  profile: InverterProfile,
  inverterId: string,
  now: Date = new Date(),
  sample: InverterSample | null = liveState.latest,
): Partial<EnergyTotals> {
  if (!sample) return {};
  if (sample.inverterId !== inverterId) return {};
  if (!isSameLocalDay(new Date(sample.time), now)) return {};

  const out: Partial<EnergyTotals> = {};
  for (const field of Object.keys(ENERGY_TODAY_FIELDS) as EnergyField[]) {
    const key = keyForRole(profile, ENERGY_TODAY_FIELDS[field]);
    if (!key) continue; // profile doesn't map this today-twin → keep the delta value
    const value = sample.metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[TOTALS_KEY_BY_FIELD[field]] = value;
    }
  }
  return out;
}

/**
 * Shared scaffolding for queries against the rollup views: the profile's
 * energy-key map plus the source fragment both readers select `from`.
 *
 * `srcSql` is a DERIVED TABLE, not a bare relation name, and that is the whole
 * identity boundary for this module. 2.0.0 keys the aggregates by
 * `(device_id int2, metric_id int2)`, but every query below reads a `metric`
 * COLUMN and dispatches on it (`fieldByKey.get(r.metric)`), and the profile hands
 * this module metric KEYS. So the sub-select resolves the identity on the way in
 * (`device_id in`, `metric_id in`) and joins `metric_keys` back on the way out,
 * exposing exactly the four columns the callers already read — `bucket`, `metric`,
 * `max_value`, `min_value`. Nothing downstream of here sees an integer.
 *
 * Both predicates are pushed INSIDE the sub-select rather than left to the outer
 * query: a derived table filtered only on its output columns would read the whole
 * aggregate for every device and every metric, then throw most of it away.
 *
 * `view` is a fixed internal literal (not user input), so it is safe to
 * interpolate as a raw identifier; the metric keys and the source id stay
 * parameterized.
 */
function rollupQueryParts(profile: InverterProfile, view: RollupView, inverterId: string) {
  const fieldByKey = resolveEnergyKeys(profile);
  const keys = [...fieldByKey.keys()];
  return {
    fieldByKey,
    srcSql: sql`(
      select r.bucket, ${metricKeyColumn("mk")}, r.max_value, r.min_value
      from ${sql.raw(view)} r ${metricKeyJoin("r", "mk")}
      where r.device_id = ${deviceIdOf(inverterId)}
        and r.metric_id in ${metricIdsOf(keys)}
    ) src`,
  };
}

/**
 * Baseline for a bucket that cannot chain to a predecessor (none at all, or one
 * on the far side of a recording gap): normally the bucket's own `min`, the rise
 * it can vouch for by itself.
 *
 * Unless the counter RESTARTED inside it. Recording resumes on the old counter,
 * the device is swapped or reflashed mid-bucket, and the bucket then holds both
 * the old lifetime level and the new near-zero one — so `max − min` is the whole
 * lifetime total billed to one hour. The stale level sitting strictly inside
 * `(min, max]` is exactly that signature (a bucket recorded wholly after the
 * restart has `max` BELOW the stale level, and one recorded wholly before it has
 * `min` at or above it), and in that case only the rise above the last known
 * level was actually observed. It is also the safe reading of a merely spurious
 * low sample: the figure can only come out smaller, never larger.
 *
 * Mirrored by the `case` in {@link fetchCounterDeltaMatrix}'s SQL.
 */
function intraBucketBase(min: number, max: number, staleMax: number | undefined): number {
  return staleMax !== undefined && staleMax > min && staleMax <= max ? staleMax : min;
}

/**
 * Read per-bucket energy for the energy roles this profile exposes, over
 * [from, to). Energy in a bucket is the monotonic counter's rise since the
 * previous bucket — `max_value − prior max_value`, clamped ≥0. `max_value` is
 * the bucket's high-water counter reading; using the cross-bucket delta (not the
 * intra-bucket `max − min`) means a spurious low read or a counter reset costs
 * at most a single bucket instead of pricing the entire lifetime total.
 *
 * The bucket immediately before `from` is read first as a baseline so the first
 * in-range bucket is a delta from real prior state; without a usable baseline —
 * no data before `from`, or a hole longer than {@link MAX_GAP_MS} — the bucket
 * falls back to its own `max − min`.
 *
 * `view` selects the rollup granularity (hourly for cost banding, daily for long
 * windows); both continuous aggregates share the same column shape.
 */
export async function fetchBucketEnergy(
  profile: InverterProfile,
  inverterId: string,
  from: Date,
  to: Date,
  view: RollupView,
): Promise<HourEnergy[]> {
  const { fieldByKey, srcSql } = rollupQueryParts(profile, view, inverterId);
  if (fieldByKey.size === 0) return [];

  // Cumulative counter level entering the window, per metric (last bucket before
  // `from`). Seeds the delta chain so the first in-range bucket is priced as a
  // rise from prior state rather than from its own intra-bucket minimum.
  const baselineRows = await db.execute<{
    metric: string;
    bucket: string | Date;
    last_max: number;
  }>(
    sql`
      select distinct on (metric) metric, bucket, max_value as last_max
      from ${srcSql}
      where bucket < ${from}
      order by metric, bucket desc
    `,
  );
  // Carries the predecessor's bucket time too: a delta is only meaningful when
  // the two readings are close enough in time to have observed the rise.
  const prev = new Map<string, { max: number; at: number }>();
  for (const r of baselineRows.rows) {
    prev.set(r.metric, { max: Number(r.last_max), at: new Date(r.bucket).getTime() });
  }
  const maxGap = MAX_GAP_MS[view];

  const rows = await db.execute<{
    bucket: string | Date;
    metric: string;
    max_value: number;
    min_value: number;
  }>(sql`
    select bucket, metric, max_value, min_value
    from ${srcSql}
    where bucket >= ${from}
      and bucket < ${to}
    order by bucket asc
  `);

  const byBucket = new Map<number, HourEnergy>();
  for (const r of rows.rows) {
    const field = fieldByKey.get(r.metric);
    if (!field) continue;
    const max = Number(r.max_value);
    const time = new Date(r.bucket);
    // No predecessor (the counter's very first bucket) or one on the far side of
    // a recording gap → use this bucket's own intra-bucket delta; otherwise the
    // rise since the previous bucket's high.
    const before = prev.get(r.metric);
    const prior =
      before && time.getTime() - before.at <= maxGap
        ? before.max
        : intraBucketBase(Number(r.min_value), max, before?.max);
    prev.set(r.metric, { max, at: time.getTime() });

    const hour = byBucket.get(time.getTime()) ?? {
      time,
      import: 0,
      export: 0,
      load: 0,
      production: 0,
      batteryDischarge: 0,
      batteryCharge: 0,
    };
    hour[field] += Math.max(0, max - prior);
    byBucket.set(time.getTime(), hour);
  }
  const hours = [...byBucket.values()];
  return metersLoadEnergy(profile) ? hours : withImpliedHourLoad(hours);
}

/** Read hourly energy for cost banding. Thin wrapper over {@link fetchBucketEnergy}. */
function fetchHourlyEnergy(
  profile: InverterProfile,
  inverterId: string,
  from: Date,
  to: Date,
): Promise<HourEnergy[]> {
  return fetchBucketEnergy(profile, inverterId, from, to, "hourly_rollups");
}

/** Granularity of a {@link computeCostSeries} bar. */
export type CostBucket = "hour" | "day" | "month";

/** One bar of the cost time-series: total money in a period. */
export interface CostSeriesPoint {
  /** Local period key: `YYYY-MM-DDTHH` (hour) | `YYYY-MM-DD` (day) | `YYYY-MM` (month). */
  bucket: string;
  importCost: number;
  exportEarnings: number;
  /**
   * Exported energy in this period that earned nothing under §51 EEG, and the
   * feed-in revenue that cost. ALWAYS present — 0 unless the tariff is in spot
   * mode with the `eegFeedIn` marketing model — so the chart can decide whether
   * to shade the period without a second request.
   */
  zeroValueExportKwh: number;
  zeroValueExportEur: number;
  /** Standing charge prorated to this period's overlap with the window. */
  standingCharge: number;
  /** `importCost − exportEarnings + standingCharge` — the all-in cost of the
   *  period, matching the headline Net cost tile. */
  net: number;
}

/** Days per average month, for prorating the monthly standing charge. */
const AVG_DAYS_PER_MONTH = 30.4375;
const DAY_MS = 86_400_000;

/** SQL date_trunc unit + the `to_char` mask that renders its local period key. */
const PERIOD_FORMAT: Record<CostBucket, { unit: string; mask: string }> = {
  hour: { unit: "hour", mask: 'YYYY-MM-DD"T"HH24' },
  day: { unit: "day", mask: "YYYY-MM-DD" },
  month: { unit: "month", mask: "YYYY-MM" },
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Plant-local period key for a Date in zone `tz`, matching the SQL `to_char`
 * masks above. `tz` defaults to the host zone so callers that predate the plant
 * zone behave unchanged; the analytics entry points pass the configured plant
 * zone so the JS zero-fill/override keys line up with the SQL `at time zone $tz`
 * bucketing (issues #46, #52).
 */
function periodKey(d: Date, bucket: CostBucket, tz: string = hostTimeZone()): string {
  const { year, month, day, hour } = zonedFields(d, tz);
  const ymd = `${year}-${pad2(month)}-${pad2(day)}`;
  if (bucket === "month") return `${year}-${pad2(month)}`;
  if (bucket === "day") return ymd;
  return `${ymd}T${pad2(hour)}`;
}

/**
 * The local period key `now` occupies at `bucket` granularity — i.e. the key of
 * the current, in-progress period in {@link fetchCounterDeltaMatrix}'s output.
 * Reuses {@link periodKey} so a live-register override lands on the exact same
 * key the matrix produced for today. `tz` must be the same plant zone the matrix
 * was bucketed in, or the override lands on the wrong bar.
 */
export function currentPeriodKey(
  bucket: CostBucket,
  now: Date = new Date(),
  tz: string = hostTimeZone(),
): string {
  return periodKey(now, bucket, tz);
}

/**
 * Each period in `[from, to)` at `bucket` granularity, oldest first: its local
 * key plus `[start, end)` bounds. Stepping uses local calendar fields so month
 * lengths and DST are handled by the Date arithmetic itself. Shared by the
 * zero-fill key list and per-period standing-charge proration.
 *
 * A period the window merely clips is left out. Callers pick calendar-aligned
 * windows, so a period only ends up part-covered when the caller's clock and
 * this server's disagree — a browser on Europe/Berlin asking for "this month"
 * sends 22:00 on the 31st, and the server would open the chart with a bar for
 * the previous month holding two hours of it. The cut-off is half a period, or
 * the whole window where that is shorter (today-by-day at 02:00 is two hours of
 * a day and still the only bar there is).
 */
/** The plant-local start instant of the period `instant` falls in, at `bucket`. */
function periodStartInstant(instant: Date, bucket: CostBucket, tz: string): Date {
  const f = zonedFields(instant, tz);
  if (bucket === "month") return zonedInstant(f.year, f.month, 1, 0, tz);
  if (bucket === "day") return zonedInstant(f.year, f.month, f.day, 0, tz);
  return zonedInstant(f.year, f.month, f.day, f.hour, tz);
}

/** The start of the period after the one beginning at `cur`, at `bucket`. */
function nextPeriodStart(cur: Date, bucket: CostBucket, tz: string): Date {
  const c = zonedFields(cur, tz);
  const next =
    bucket === "month"
      ? zonedInstant(c.year, c.month + 1, 1, 0, tz)
      : bucket === "day"
        ? zonedInstant(c.year, c.month, c.day + 1, 0, tz)
        : zonedInstant(c.year, c.month, c.day, c.hour + 1, tz);
  // A fall-back DST hour can resolve the next wall-clock boundary at or before
  // `cur`; force forward progress so the loop always terminates.
  return next.getTime() > cur.getTime() ? next : new Date(cur.getTime() + HOUR_MS);
}

function eachPeriod(
  from: Date,
  to: Date,
  bucket: CostBucket,
  tz: string = hostTimeZone(),
): Array<{ key: string; start: Date; end: Date }> {
  const out: Array<{ key: string; start: Date; end: Date }> = [];
  const windowMs = to.getTime() - from.getTime();
  // Boundaries are plant-local period starts resolved to real UTC instants in
  // `tz`, so month lengths and DST (23h/25h days) come from the zone rules, not
  // the host clock.
  let cur = periodStartInstant(from, bucket, tz);
  while (cur < to) {
    const next = nextPeriodStart(cur, bucket, tz);
    const covered =
      Math.min(next.getTime(), to.getTime()) - Math.max(cur.getTime(), from.getTime());
    if (covered >= Math.min((next.getTime() - cur.getTime()) / 2, windowMs)) {
      out.push({ key: periodKey(cur, bucket, tz), start: new Date(cur), end: new Date(next) });
    }
    cur = next;
  }
  return out;
}

/**
 * Every local period key in `[from, to)` at `bucket` granularity, oldest first.
 * Drives zero-fill so the chart x-axis is stable and gap-free regardless of
 * which periods actually have data.
 */
function periodKeysInRange(
  from: Date,
  to: Date,
  bucket: CostBucket,
  tz: string = hostTimeZone(),
): string[] {
  return eachPeriod(from, to, bucket, tz).map((p) => p.key);
}

/** One row of {@link fetchCounterDeltaMatrix}: energy (kWh) for a metric within a
 *  period, further split by the local hour-of-day and ISO weekday it fell on. */
export interface CounterDeltaRow {
  period: string;
  /** Local hour-of-day 0–23 (meaningful only for sub-daily source views). */
  hod: number;
  /** Local ISO weekday 1 (Mon) – 7 (Sun). */
  dow: number;
  metric: string;
  kwh: number;
}

/** Result of {@link fetchCounterDeltaMatrix}. */
export interface CounterDeltaMatrix {
  rows: CounterDeltaRow[];
  /** metric key → the energy field it feeds, for the roles this profile exposes. */
  fieldByKey: Map<string, EnergyField>;
  /** Zero-fill period keys in `[from, to)`, oldest first. */
  periods: string[];
}

/**
 * Bounded counter-delta matrix over `[from, to)`: per-metric energy (the
 * `max_value` rise since the previous rollup bucket, clamped ≥0) aggregated to
 * `(period, hour-of-day, ISO-weekday)`. The row count is fixed by the calendar
 * shape (≤ periods·24·7·metrics), never by how many rollup buckets the window
 * spans — the delta and the rollup both happen in SQL, so nothing ships every
 * bucket across the wire.
 *
 * `view` picks the source granularity: hourly keeps the hour-of-day detail
 * time-of-use pricing needs; daily is cheaper for long windows that only care
 * about per-period totals. Local wall-clock (server tz) drives the
 * period/hour/weekday so downstream banding matches the per-hour path. A
 * per-metric baseline bucket from just before the window seeds the delta chain,
 * so the first in-window bucket is a real rise (not dropped by a null `lag`);
 * only the first bucket in a metric's entire history falls back to its own
 * intra-bucket min.
 */
export async function fetchCounterDeltaMatrix(
  profile: InverterProfile,
  opts: {
    from: Date;
    to: Date;
    bucket: CostBucket;
    inverterId?: string;
    view?: RollupView;
    /** Plant IANA zone for period/hour bucketing; defaults to the host zone. */
    tz?: string;
  },
): Promise<CounterDeltaMatrix> {
  const { from, to, bucket } = opts;
  const inverterId = opts.inverterId ?? profile.id;
  const view = opts.view ?? "hourly_rollups";
  // Plant zone so SQL wall-clock and the JS zero-fill keys agree, and neither
  // depends on the host process zone (issues #46, #52).
  const tz = opts.tz ?? hostTimeZone();
  const { fieldByKey, srcSql } = rollupQueryParts(profile, view, inverterId);
  const periods = periodKeysInRange(from, to, bucket, tz);
  if (fieldByKey.size === 0) return { rows: [], fieldByKey, periods };

  const { unit, mask } = PERIOD_FORMAT[bucket];

  const rows = await db.execute<{
    period: string;
    hod: number;
    dow: number;
    metric: string;
    kwh: number;
  }>(sql`
    with src as (
      -- Buckets inside the window.
      select bucket, metric, max_value, min_value
      from ${srcSql}
      where bucket >= ${from}
        and bucket < ${to}
      union all
      -- Baseline: last bucket strictly before the window, per metric. Seeds the
      -- delta chain so the first in-window bucket is a rise from prior state, not
      -- dropped by a null lag(). Filtered back out after the window fn runs.
      select bucket, metric, max_value, min_value
      from (
        select distinct on (metric) bucket, metric, max_value, min_value
        from ${srcSql}
        where bucket < ${from}
        order by metric, bucket desc
      ) baseline
    ),
    chained as (
      select
        bucket,
        metric,
        max_value,
        min_value,
        lag(max_value) over (partition by metric order by bucket) as prev_max,
        lag(bucket) over (partition by metric order by bucket) as prev_bucket
      from src
    ),
    deltas as (
      select
        bucket,
        (bucket at time zone ${tz}) as local_bucket,
        metric,
        -- Rise since the previous bucket's high, clamped ≥0. No predecessor (the
        -- very first bucket in history) or one on the far side of a recording gap
        -- → fall back to this bucket's own min, matching fetchBucketEnergy —
        -- except when a stale level lies strictly inside (min, max], the
        -- signature of a counter restart INSIDE this bucket, where max − min
        -- would bill the whole lifetime total to one bucket (intraBucketBase).
        greatest(
          0,
          max_value - case
            when prev_bucket is not null
              and bucket - prev_bucket <= make_interval(secs => ${MAX_GAP_MS[view] / 1000})
              then prev_max
            when prev_max is not null and prev_max > min_value and prev_max <= max_value
              then prev_max
            else min_value
          end
        ) as kwh
      from chained
    )
    select
      to_char(date_trunc(${unit}, local_bucket), ${mask}) as period,
      extract(hour from local_bucket)::int as hod,
      extract(isodow from local_bucket)::int as dow,
      metric,
      sum(kwh) as kwh
    from deltas
    where bucket >= ${from}
    group by 1, 2, 3, 4
  `);
  return { rows: rows.rows, fieldByKey, periods };
}

/**
 * Prorated standing charge per period key: the monthly standing charge split
 * across `[from, to)` by each period's overlap with the window (partial first/
 * last periods included). Summed over all periods this equals the tiles'
 * standingCharge, so the bars and the headline Net tile agree.
 *
 * The overlap also stops at `now`: a window may reach past the present so the
 * chart shows the whole calendar month, and a standing charge for days that
 * haven't happened would be both a bar out of nowhere and more charge than the
 * tiles report.
 */
function standingByPeriod(
  from: Date,
  to: Date,
  bucket: CostBucket,
  monthly: number,
  now: Date = new Date(),
  tz: string = hostTimeZone(),
): Map<string, number> {
  const perDay = monthly / AVG_DAYS_PER_MONTH;
  const charged = Math.min(to.getTime(), now.getTime());
  const out = new Map<string, number>();
  for (const { key, start, end } of eachPeriod(from, to, bucket, tz)) {
    // Overlap of this period with the window, in days (partial edges included).
    const s = Math.max(start.getTime(), from.getTime());
    const e = Math.min(end.getTime(), charged);
    out.set(key, perDay * Math.max(0, (e - s) / DAY_MS));
  }
  return out;
}

/**
 * Total cost per period ([from, to), one point per `bucket`), tariff-band
 * accurate and zero-filled. Reads the bounded {@link fetchCounterDeltaMatrix}
 * from the hourly rollups (hour-of-day is needed for time-of-use banding), then
 * prices the groups in JS via {@link priceSeriesRows} — exactly as
 * {@link allocateCost} would per hour, without shipping every hour across the
 * wire. The monthly standing charge is prorated into each period so a bar is
 * the period's all-in cost.
 *
 * Under §51 the export side needs the row's real wall-clock hour, which
 * `(period, hod)` only pins for the hour and day buckets. So a month request
 * runs the matrix at DAY granularity and rolls the priced days up — the same
 * bars, priced where the hour is knowable.
 */
export async function computeCostSeries(
  profile: InverterProfile,
  opts: { from: Date; to: Date; bucket: CostBucket; inverterId?: string },
): Promise<CostSeriesPoint[]> {
  const tariff = await getTariff();
  const tz = await getPlantTimeZone();
  const zeroValueShare = await zeroValueShareFor(tariff, opts.from, opts.to);
  const rollUp = zeroValueShare !== undefined && opts.bucket === "month";
  const bucket = rollUp ? "day" : opts.bucket;

  const { rows, fieldByKey, periods } = await fetchCounterDeltaMatrix(profile, {
    ...opts,
    bucket,
    view: "hourly_rollups",
    tz,
  });
  const standing = standingByPeriod(
    opts.from,
    opts.to,
    bucket,
    tariff.standingChargeMonthly,
    new Date(),
    tz,
  );
  const points = priceSeriesRows(rows, fieldByKey, periods, tariff, standing, zeroValueShare);
  return rollUp ? rollUpToMonths(points) : points;
}

/** The plant-local day's midnight (as a UTC instant), in zone `tz`. */
function startOfLocalDay(now: Date, tz: string = hostTimeZone()): Date {
  return startOfZonedDay(now, tz);
}

/**
 * Whether `[from, to)` contains all of today so far — today, month-to-date,
 * year-to-date, a custom range running to the present. These windows take the
 * live `*.today` override for their today slice (see {@link computeCost}); a
 * window that starts mid-day or ended before now does not, since the whole-day
 * register can't be apportioned to part of a day.
 *
 * `to` is accepted when it is at or past this moment, or simply lands on today:
 * the presets resolve `to` to their caller's `now`, which is a few milliseconds
 * behind the one asked here, and that is a clock artefact, not a past window.
 */
function coversTodaySoFar(from: Date, to: Date, now: Date, tz: string = hostTimeZone()): boolean {
  const midnight = startOfLocalDay(now, tz);
  return from.getTime() <= midnight.getTime() && (to >= now || isSameLocalDay(to, now, tz));
}

/** The counter-delta energy a window already counted for today, by totals key.
 *  What {@link replaceTodaySlice} exchanges for the live registers. */
function todayFromHours(hours: HourEnergy[], midnight: Date): EnergyTotals {
  const out = emptyTotals();
  for (const h of hours) {
    if (h.time.getTime() < midnight.getTime()) continue;
    for (const [field, key] of Object.entries(TOTALS_KEY_BY_FIELD)) {
      out[key] += h[field as EnergyField];
    }
  }
  return out;
}

/**
 * Report the live `*.today` energy on top of a window's per-hour cost totals:
 * exchange today's delta-derived slice for the live registers (only the fields
 * the reader supplied) and RECOMPUTE the pure derived-energy / ratio fields from
 * the result — mirroring {@link allocateCost}'s formulas exactly so the tiles
 * stay coherent.
 *
 * `deltaToday` is today's own contribution to `totals`, so a month-to-date
 * window keeps its earlier days and only its today slice moves. For the `today`
 * window itself that slice IS the whole window, and this reduces to a plain
 * replacement.
 *
 * Deliberate split: the MONEY fields (importCost, exportEarnings,
 * standingCharge, net, gridOnlyCost, savings, solarSavings, byDay, byBand) pass
 * through untouched. They are priced per-hour-of-day tariff band from the
 * `*.total` deltas and stay authoritative for money — a day register can't be
 * banded — so the reported kWh and its priced cost may diverge slightly while
 * the day is in progress.
 *
 * `impliedLoad` says the plant meters no consumption at all
 * ({@link metersLoadEnergy}), so its house figure is derived rather than read.
 */
function reportLiveTodayTotals(
  totals: CostTotals,
  today: Partial<EnergyTotals>,
  deltaToday: EnergyTotals,
  impliedLoad: boolean,
): CostTotals {
  const swapped = replaceTodaySlice(totals, deltaToday, today);
  // An implied consumption has to be re-implied from the swapped flows: it was
  // computed per hour off the counter deltas, and leaving it there would report
  // a house figure that contradicts the import/export/production printed beside
  // it. A metered plant has nothing to re-derive.
  const energy = impliedLoad ? { ...swapped, loadKwh: impliedLoadKwh(swapped) } : swapped;
  const { importKwh, exportKwh, loadKwh, productionKwh } = energy;
  return {
    ...totals,
    ...energy,
    solarToLoadKwh: Math.max(0, loadKwh - importKwh),
    selfSufficiency: loadKwh > 0 ? clamp01((loadKwh - importKwh) / loadKwh) : null,
    selfConsumption:
      productionKwh > 0 ? clamp01((productionKwh - exportKwh) / productionKwh) : null,
  };
}

/**
 * How much of each hour cleared at a negative day-ahead price, for §51 pricing.
 *
 * Returns undefined — meaning "price export normally" — unless the tariff is
 * actually in spot mode under the `eegFeedIn` marketing model. A plant that
 * never opted in pays for no price lookup and its figures are unchanged.
 *
 * Keyed by real wall-clock hour, which is what every caller must supply.
 * `fetchCounterDeltaMatrix` groups by (period, hour-of-day, weekday), and at
 * the MONTH bucket that collapses "14:00 on the 3rd" and "14:00 on the 17th"
 * into one row — there is no single spot price to apply to that, and the error
 * would be unbounded rather than a rounding. At the hour and day buckets the
 * pair pins one real hour, so {@link computeCostSeries} prices them directly
 * and drops a month request to day granularity before rolling up.
 */
async function zeroValueShareFor(
  tariff: TariffConfig,
  from: Date,
  to: Date,
): Promise<ZeroValueShare | undefined> {
  if (tariff.export.mode !== "spot" || tariff.export.spot.marketingModel !== "eegFeedIn") {
    return undefined;
  }
  const [{ getSpotPrices }, { getSpotPriceConfig }] = await Promise.all([
    import("@SunReye/db/spot-price"),
    import("../settings/spot-price-settings"),
  ]);
  const rows = await getSpotPrices((await getSpotPriceConfig()).zone, from, to);
  if (rows.length === 0) return undefined;

  // Slots per hour, and how many were negative. An hour with no stored price
  // contributes nothing: unknown is not "negative".
  const byHour = new Map<number, { negative: number; total: number }>();
  for (const row of rows) {
    const hourStart = new Date(row.slotStart).setMinutes(0, 0, 0);
    const seen = byHour.get(hourStart) ?? { negative: 0, total: 0 };
    seen.total += 1;
    if (row.eurPerMwh < 0) seen.negative += 1;
    byHour.set(hourStart, seen);
  }
  return (hour: Date) => {
    const seen = byHour.get(new Date(hour).setMinutes(0, 0, 0));
    return seen ? seen.negative / seen.total : 0;
  };
}

/** Full cost breakdown for an explicit [from, to) window. */
export async function computeCost(
  profile: InverterProfile,
  opts: {
    from: Date;
    to: Date;
    inverterId?: string;
  },
): Promise<CostBreakdown> {
  const inverterId = opts.inverterId ?? profile.id;
  const tariff = await getTariff();
  const tz = await getPlantTimeZone();
  const hours = await fetchHourlyEnergy(profile, inverterId, opts.from, opts.to);
  const rangeDays = Math.max(0, (opts.to.getTime() - opts.from.getTime()) / 86_400_000);
  const totals = allocateCost(
    hours,
    tariff,
    rangeDays,
    await zeroValueShareFor(tariff, opts.from, opts.to),
    tz,
  );

  // Any window running up to now — today, month-to-date, year-to-date — reports
  // today's ENERGY kWh from the live *.today registers, which lead the coarse
  // cross-bucket *.total delta for the in-progress day and match the dashboard
  // headline; the ratios are recomputed from the result and money stays per-hour
  // (see reportLiveTodayTotals). The slice is exchanged, not the total, so a
  // month can never report less energy than the day inside it.
  const now = new Date();
  const reported = coversTodaySoFar(opts.from, opts.to, now, tz)
    ? reportLiveTodayTotals(
        totals,
        liveTodayTotals(profile, inverterId, now),
        todayFromHours(hours, startOfLocalDay(now, tz)),
        !metersLoadEnergy(profile),
      )
    : totals;

  return {
    currency: tariff.currency,
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    ...reported,
  };
}
