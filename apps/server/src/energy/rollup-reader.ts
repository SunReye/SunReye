/**
 * The rollup reader: every read of stored energy — the counter deltas in the
 * TimescaleDB rollups, and the device's own registers on the poll cache. Owns
 * which register a field is differenced from, how a delta chains across buckets,
 * and the SQL that mirrors it. The cost engine ({@link ./cost}), the energy split
 * ({@link ./energy}) and the statistics read through {@link RollupReader}.
 */

import type { EnergyField, EnergyTotals, HourEnergy } from "@SunReye/contracts/energy";
import { db } from "@SunReye/db";
import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { dateKey } from "@SunReye/inverter-core/zoned-calendar";
import { sql } from "drizzle-orm";
import { deviceScope, metricIdsOf, metricKeyColumn, metricKeyJoin } from "../shared/identity-sql";
import { type SeriesTarget, isPlantTarget } from "../shared/plant-source";
import { liveState } from "../shared/state";
import { emptyTotals, withImpliedHourLoad } from "./energy-calc";
import { type CostBucket, periodKeysInRange } from "./period-keys";

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
 * This is not documentation. `rollup-reader.test.ts` ("energy derivation per role")
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
 * the device's own `*.today` registers. Which register an hourly bucket
 * differences ({@link energyKeyFor}) does not change the verdict: a difference of
 * readings is a difference of readings either way. Nothing in this layer
 * integrates power.
 * The one integrated energy figure in the product is the browser-side
 * reconstruction in
 * `apps/web/src/lib/components/inverter/_shared/measured-day.ts`.
 */
// fallow-ignore-next-line unused-export -- the verdict rollup-reader.test.ts measures the code against; test files aren't traced as consumers
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
 * The register a field's bucket deltas are differenced from, and whether it is
 * the kind that resets every day.
 *
 * The `*.today` twin wins wherever the profile maps one and the view is hourly,
 * because differencing a LIFETIME odometer has an unbounded worst case: a bucket
 * with no usable predecessor falls back to its own `max − min`, and on a freshly
 * booted appliance the first poll of the first hour answers 0 for a register it
 * has not read yet while the next answers the whole odometer — 3 755.7 kWh of
 * imported energy billed to 05:00 on day one, with the chart, the split,
 * self-sufficiency and the bill downstream of it. From `(min, max)` alone that
 * bucket is indistinguishable from a counter that genuinely starts at zero, so
 * the rule cannot tell them apart; the register can. A day counter bounds the
 * worst case at one day, and on a first boot holds no odometer to book.
 *
 * A day/month view keeps the odometer: a counter that resets at midnight says
 * nothing about the rise across a bucket a day or longer ({@link RollupView}).
 */
function energyKeyFor(
  profile: InverterProfile,
  field: EnergyField,
  view: RollupView,
): { key: string; resetsDaily: boolean } | undefined {
  const dayKey =
    view === "hourly_rollups" ? keyForRole(profile, ENERGY_TODAY_FIELDS[field]) : undefined;
  if (dayKey) return { key: dayKey, resetsDaily: true };
  const key = keyForRole(profile, ENERGY_FIELDS[field]);
  return key ? { key, resetsDaily: false } : undefined;
}

/**
 * Metric key → the HourEnergy field it feeds, for the roles this profile has,
 * plus the subset of those keys that reset daily. One key per field: the two
 * derivations coexist across fields, never within one.
 */
function resolveEnergyKeys(
  profile: InverterProfile,
  view: RollupView,
): { fieldByKey: Map<string, EnergyField>; dailyKeys: Set<string> } {
  const fieldByKey = new Map<string, EnergyField>();
  const dailyKeys = new Set<string>();
  for (const field of Object.keys(ENERGY_FIELDS) as EnergyField[]) {
    const found = energyKeyFor(profile, field, view);
    if (!found) continue;
    fieldByKey.set(found.key, field);
    if (found.resetsDaily) dailyKeys.add(found.key);
  }
  return { fieldByKey, dailyKeys };
}

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
function isSameLocalDay(a: Date, b: Date, tz: string): boolean {
  return dateKey(a, tz) === dateKey(b, tz);
}

/**
 * The live current-day energy totals, as a partial {@link EnergyTotals} carrying
 * only the fields safe to trust. `now` and `sample` default to the live clock and
 * the poll cache, and are injectable so the guards below are unit-testable
 * without a running poll loop (see rollup-reader.test.ts). Returns `{}` (no override)
 * unless ALL hold:
 *  - a sample exists;
 *  - `sample.inverterId` matches the query's effective `inverterId`;
 *  - the sample is from TODAY in the plant zone `tz` — a stale sample carried
 *    across midnight must not override the fresh day.
 * A field is included only when its `*.today` twin role is mapped by the profile
 * AND the sample carries a finite value for that role's metric key; every other
 * field is left to the caller's `*.total`-delta value.
 */
/**
 * Whether the poll cache's one sample is the target's own reading. It holds ONE
 * device's sample, which speaks for the plant only when that device is the
 * plant's sole member; a two-inverter plant keeps the counter delta, which is
 * at least the whole plant's.
 */
function speaksFor(sample: InverterSample, target: SeriesTarget): boolean {
  if (!isPlantTarget(target)) return sample.inverterId === target;
  return target.plant.length === 1 && target.plant[0]?.slug === sample.inverterId;
}

export function liveTodayTotals(
  profile: InverterProfile,
  target: SeriesTarget,
  tz: string,
  now: Date = new Date(),
  sample: InverterSample | null = liveState.latest,
): Partial<EnergyTotals> {
  if (!sample || !speaksFor(sample, target)) return {};
  if (!isSameLocalDay(new Date(sample.time), now, tz)) return {};

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
 * The plant's LIFETIME counters as the poll cache last saw them: every field of
 * {@link ENERGY_FIELDS} the profile maps, read straight off the `*.total`
 * registers. Unlike {@link liveTodayTotals} the sample's age is irrelevant — a
 * lifetime counter read yesterday is still the lifetime counter.
 *
 * `null` when the sample cannot answer: none at all, one that does not speak for
 * the target (a plant of several members), or one missing a mapped register —
 * a partial set would price the missing counter as 0 kWh, "the plant never
 * bought anything". Unmapped fields are zero, which IS the right answer for a
 * role the plant does not have.
 */
export function liveCounterLevels(
  profile: InverterProfile,
  target: SeriesTarget,
  sample: InverterSample | null = liveState.latest,
): EnergyTotals | null {
  if (!sample || !speaksFor(sample, target)) return null;
  const out = emptyTotals();
  for (const field of Object.keys(ENERGY_FIELDS) as EnergyField[]) {
    const key = keyForRole(profile, ENERGY_FIELDS[field]);
    if (!key) continue;
    const value = sample.metrics[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    out[TOTALS_KEY_BY_FIELD[field]] = value;
  }
  return out;
}

/**
 * The lifetime counters from the forever-retained daily tier: each mapped
 * metric's high in its newest bucket (real-time aggregation includes today's).
 * The fallback for {@link liveCounterLevels} — a plant of several members has
 * no single sample, and a device that has not polled since boot has none.
 * A plant target reads the members' levels summed per bucket, like every other
 * rollup read. `null` when nothing has ever been recorded.
 */
export async function fetchLatestCounterLevels(
  profile: InverterProfile,
  target: SeriesTarget,
): Promise<EnergyTotals | null> {
  const { fieldByKey, srcSql } = rollupQueryParts(profile, "daily_rollups", target);
  if (fieldByKey.size === 0) return null;
  const res = await db.execute<{ metric: string; max_value: number | string }>(sql`
    select distinct on (metric) metric, max_value
    from ${srcSql}
    order by metric, bucket desc
  `);
  if (res.rows.length === 0) return null;
  const out = emptyTotals();
  for (const row of res.rows) {
    const field = fieldByKey.get(row.metric);
    if (field) out[TOTALS_KEY_BY_FIELD[field]] = Number(row.max_value);
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
function rollupQueryParts(profile: InverterProfile, view: RollupView, target: SeriesTarget) {
  const { fieldByKey, dailyKeys } = resolveEnergyKeys(profile, view);
  const keys = [...fieldByKey.keys()];
  const scope = deviceScope(target, "r");
  // A counter is a `sum` role (see `plantAggregateOf`), so the plant's counter
  // level is the members' levels added per bucket. A member with no row in a
  // bucket contributes nothing to it; the clamp downstream absorbs the dip.
  const srcSql = isPlantTarget(target)
    ? sql`(
      select r.bucket, ${metricKeyColumn("mk")},
             sum(r.max_value) as max_value, sum(r.min_value) as min_value
      from ${sql.raw(view)} r ${metricKeyJoin("r", "mk")}
      where ${scope}
        and r.metric_id in ${metricIdsOf(keys)}
      group by r.bucket, mk.key
    ) src`
    : sql`(
      select r.bucket, ${metricKeyColumn("mk")}, r.max_value, r.min_value
      from ${sql.raw(view)} r ${metricKeyJoin("r", "mk")}
      where ${scope}
        and r.metric_id in ${metricIdsOf(keys)}
    ) src`;
  return { fieldByKey, dailyKeys, srcSql };
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
 * Whether a bucket may price itself as the rise since the predecessor it has.
 *
 * Two ways it may not. A predecessor further back than {@link MAX_GAP_MS} never
 * watched the rise, and a DAILY-resetting register's predecessor in another
 * plant-local day watched a counter that has since gone back to zero — the drop
 * looks exactly like a counter reset, and chaining through it would clamp the
 * first hour of every day to nothing. Either way the bucket falls back to what
 * it can vouch for by itself ({@link intraBucketBase}).
 *
 * The day boundary is the PLANT's ({@link getPlantTimeZone}), not the host's and
 * not the viewer's — the device resets on local midnight where it stands.
 *
 * Mirrored by the `case` in {@link fetchCounterDeltaMatrix}'s SQL.
 */
function chainsTo(
  before: { max: number; at: number },
  bucket: Date,
  maxGap: number,
  resetsDaily: boolean,
  tz: string,
): boolean {
  if (bucket.getTime() - before.at > maxGap) return false;
  return !resetsDaily || isSameLocalDay(new Date(before.at), bucket, tz);
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
 * windows); both continuous aggregates share the same column shape — and, via
 * {@link energyKeyFor}, which register each field is read from. `tz` is the
 * plant zone the day registers reset in (issues #46, #52).
 */
export async function fetchBucketEnergy(
  profile: InverterProfile,
  inverterId: SeriesTarget,
  from: Date,
  to: Date,
  view: RollupView,
  tz: string,
): Promise<HourEnergy[]> {
  const { fieldByKey, dailyKeys, srcSql } = rollupQueryParts(profile, view, inverterId);
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
    // No predecessor (the counter's very first bucket), one on the far side of a
    // recording gap, or — for a day register — one on the far side of midnight →
    // use this bucket's own intra-bucket delta; otherwise the rise since the
    // previous bucket's high.
    const before = prev.get(r.metric);
    const prior =
      before && chainsTo(before, time, maxGap, dailyKeys.has(r.metric), tz)
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

/** SQL date_trunc unit + the `to_char` mask that renders its local period key. */
const PERIOD_FORMAT: Record<CostBucket, { unit: string; mask: string }> = {
  hour: { unit: "hour", mask: 'YYYY-MM-DD"T"HH24' },
  day: { unit: "day", mask: "YYYY-MM-DD" },
  month: { unit: "month", mask: "YYYY-MM" },
};

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
 * about per-period totals. Plant wall-clock (`tz`) drives the
 * period/hour/weekday so downstream banding matches the per-hour path. A
 * per-metric baseline bucket from just before the window seeds the delta chain,
 * so the first in-window bucket is a real rise (not dropped by a null `lag`);
 * only the first bucket in a metric's entire history falls back to its own
 * intra-bucket min.
 */
export async function fetchCounterDeltaMatrix(
  profile: InverterProfile,
  opts: CounterDeltaOptions,
): Promise<CounterDeltaMatrix> {
  const { from, to, bucket } = opts;
  const inverterId = opts.inverterId ?? profile.id;
  const view = opts.view ?? "hourly_rollups";
  // Plant zone so SQL wall-clock and the JS zero-fill keys agree, and neither
  // depends on the host process zone (issues #46, #52).
  const { tz } = opts;
  const { fieldByKey, dailyKeys, srcSql } = rollupQueryParts(profile, view, inverterId);
  const periods = periodKeysInRange(from, to, bucket, tz);
  if (fieldByKey.size === 0) return { rows: [], fieldByKey, periods };

  const { unit, mask } = PERIOD_FORMAT[bucket];
  // The `resetsDaily` half of `chainsTo`, as a predicate over the row's metric.
  // Never `metric in ()`, which is a syntax error — a profile mapping no day
  // twin at all simply has no daily-resetting metric.
  const resetsDaily = dailyKeys.size === 0 ? sql`false` : sql`metric in ${[...dailyKeys]}`;

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
        -- very first bucket in history), one on the far side of a recording gap,
        -- or — for a register that resets every day — one on the far side of the
        -- plant's midnight → fall back to this bucket's own min, matching
        -- fetchBucketEnergy's chainsTo —
        -- except when a stale level lies strictly inside (min, max], the
        -- signature of a counter restart INSIDE this bucket, where max − min
        -- would bill the whole lifetime total to one bucket (intraBucketBase).
        greatest(
          0,
          max_value - case
            when prev_bucket is not null
              and bucket - prev_bucket <= make_interval(secs => ${MAX_GAP_MS[view] / 1000})
              and not (
                ${resetsDaily}
                and date_trunc('day', bucket at time zone ${tz})
                  <> date_trunc('day', prev_bucket at time zone ${tz})
              )
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

/** Options of {@link fetchCounterDeltaMatrix}. */
export interface CounterDeltaOptions {
  from: Date;
  to: Date;
  bucket: CostBucket;
  inverterId?: SeriesTarget;
  view?: RollupView;
  /** Plant IANA zone for period/hour bucketing. */
  tz: string;
}

/**
 * The seam the pricing and reporting modules read stored energy through. The
 * database-backed {@link dbRollupReader} is the only production adapter; a test
 * hands in rows instead of standing a fake database behind the SQL.
 */
export interface RollupReader {
  bucketEnergy(
    profile: InverterProfile,
    target: SeriesTarget,
    from: Date,
    to: Date,
    view: RollupView,
    tz: string,
  ): Promise<HourEnergy[]>;
  counterDeltaMatrix(
    profile: InverterProfile,
    opts: CounterDeltaOptions,
  ): Promise<CounterDeltaMatrix>;
}

export const dbRollupReader: RollupReader = {
  bucketEnergy: fetchBucketEnergy,
  counterDeltaMatrix: fetchCounterDeltaMatrix,
};
