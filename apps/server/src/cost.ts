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

import { db } from "@SunReye/db";
import type { TariffConfig } from "@SunReye/db/tariff";
import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { sql } from "drizzle-orm";
import {
  type CostBreakdown,
  type CostTotals,
  type HourEnergy,
  type ZeroValueShare,
  allocateCost,
  priceSeriesRows,
  rollUpToMonths,
} from "./cost-calc";
import type { EnergyTotals } from "./energy-calc";
import { getTariff } from "./settings";
import { liveState } from "./state";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export type { CostBreakdown } from "./cost-calc";
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

export type EnergyField = keyof Omit<HourEnergy, "time">;

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

/** Whether two Dates fall on the same local (server-tz) calendar day. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
 * energy-key map plus the SQL fragments both readers interpolate. `view` is a
 * fixed internal literal (not user input), so it is safe to interpolate as a
 * raw identifier; the metric keys stay parameterized.
 */
function rollupQueryParts(profile: InverterProfile, view: RollupView) {
  const fieldByKey = resolveEnergyKeys(profile);
  return {
    fieldByKey,
    viewSql: sql.raw(view),
    keyList: sql.join(
      [...fieldByKey.keys()].map((k) => sql`${k}`),
      sql`, `,
    ),
  };
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
  const { fieldByKey, viewSql, keyList } = rollupQueryParts(profile, view);
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
      from ${viewSql}
      where inverter_id = ${inverterId}
        and metric in (${keyList})
        and bucket < ${from}
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
    from ${viewSql}
    where inverter_id = ${inverterId}
      and metric in (${keyList})
      and bucket >= ${from}
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
    const prior = before && time.getTime() - before.at <= maxGap ? before.max : Number(r.min_value);
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
  return [...byBucket.values()];
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

/** Local period key for a Date, matching the SQL `to_char` masks above. */
function periodKey(d: Date, bucket: CostBucket): string {
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (bucket === "month") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  if (bucket === "day") return ymd;
  return `${ymd}T${pad2(d.getHours())}`;
}

/**
 * The local period key `now` occupies at `bucket` granularity — i.e. the key of
 * the current, in-progress period in {@link fetchCounterDeltaMatrix}'s output.
 * Reuses {@link periodKey} so a live-register override lands on the exact same
 * key the matrix produced for today.
 */
export function currentPeriodKey(bucket: CostBucket, now: Date = new Date()): string {
  return periodKey(now, bucket);
}

/**
 * Each period in `[from, to)` at `bucket` granularity, oldest first: its local
 * key plus `[start, end)` bounds. Stepping uses local calendar fields so month
 * lengths and DST are handled by the Date arithmetic itself. Shared by the
 * zero-fill key list and per-period standing-charge proration.
 */
function eachPeriod(
  from: Date,
  to: Date,
  bucket: CostBucket,
): Array<{ key: string; start: Date; end: Date }> {
  const out: Array<{ key: string; start: Date; end: Date }> = [];
  const cur =
    bucket === "month"
      ? new Date(from.getFullYear(), from.getMonth(), 1)
      : bucket === "day"
        ? new Date(from.getFullYear(), from.getMonth(), from.getDate())
        : new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours());
  while (cur < to) {
    const next = new Date(cur);
    if (bucket === "month") next.setMonth(next.getMonth() + 1);
    else if (bucket === "day") next.setDate(next.getDate() + 1);
    else next.setHours(next.getHours() + 1);
    out.push({ key: periodKey(cur, bucket), start: new Date(cur), end: new Date(next) });
    cur.setTime(next.getTime());
  }
  return out;
}

/**
 * Every local period key in `[from, to)` at `bucket` granularity, oldest first.
 * Drives zero-fill so the chart x-axis is stable and gap-free regardless of
 * which periods actually have data.
 */
function periodKeysInRange(from: Date, to: Date, bucket: CostBucket): string[] {
  return eachPeriod(from, to, bucket).map((p) => p.key);
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
  opts: { from: Date; to: Date; bucket: CostBucket; inverterId?: string; view?: RollupView },
): Promise<CounterDeltaMatrix> {
  const { from, to, bucket } = opts;
  const inverterId = opts.inverterId ?? profile.id;
  const view = opts.view ?? "hourly_rollups";
  const { fieldByKey, viewSql, keyList } = rollupQueryParts(profile, view);
  const periods = periodKeysInRange(from, to, bucket);
  if (fieldByKey.size === 0) return { rows: [], fieldByKey, periods };

  const { unit, mask } = PERIOD_FORMAT[bucket];
  // Server-local IANA zone so SQL wall-clock matches the per-hour path's getHours().
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
      from ${viewSql}
      where inverter_id = ${inverterId}
        and metric in (${keyList})
        and bucket >= ${from}
        and bucket < ${to}
      union all
      -- Baseline: last bucket strictly before the window, per metric. Seeds the
      -- delta chain so the first in-window bucket is a rise from prior state, not
      -- dropped by a null lag(). Filtered back out after the window fn runs.
      select bucket, metric, max_value, min_value
      from (
        select distinct on (metric) bucket, metric, max_value, min_value
        from ${viewSql}
        where inverter_id = ${inverterId}
          and metric in (${keyList})
          and bucket < ${from}
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
        -- → fall back to this bucket's own min, matching fetchBucketEnergy.
        greatest(
          0,
          max_value - case
            when prev_bucket is not null
              and bucket - prev_bucket <= make_interval(secs => ${MAX_GAP_MS[view] / 1000})
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
 */
function standingByPeriod(
  from: Date,
  to: Date,
  bucket: CostBucket,
  monthly: number,
): Map<string, number> {
  const perDay = monthly / AVG_DAYS_PER_MONTH;
  const out = new Map<string, number>();
  for (const { key, start, end } of eachPeriod(from, to, bucket)) {
    // Overlap of this period with the window, in days (partial edges included).
    const s = Math.max(start.getTime(), from.getTime());
    const e = Math.min(end.getTime(), to.getTime());
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
  const zeroValueShare = await zeroValueShareFor(tariff, opts.from, opts.to);
  const rollUp = zeroValueShare !== undefined && opts.bucket === "month";
  const bucket = rollUp ? "day" : opts.bucket;

  const { rows, fieldByKey, periods } = await fetchCounterDeltaMatrix(profile, {
    ...opts,
    bucket,
    view: "hourly_rollups",
  });
  const standing = standingByPeriod(opts.from, opts.to, bucket, tariff.standingChargeMonthly);
  const points = priceSeriesRows(rows, fieldByKey, periods, tariff, standing, zeroValueShare);
  return rollUp ? rollUpToMonths(points) : points;
}

/**
 * Whether `[from, to)` is exactly the current day up to now — the `range:
 * "today"` case: `from` is this local day's midnight and `to` lands on today
 * (at or after `from`). Only this window may take the live `*.today` override;
 * month/year windows never do (see {@link computeCost}). Note: on the 1st of a
 * month/year the month/year-to-date IS just today, so this correctly returns
 * true — overriding the tiny window with the live register is coherent there.
 */
function isTodayWindow(from: Date, to: Date, now: Date = new Date()): boolean {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return (
    from.getTime() === midnight.getTime() &&
    to.getTime() >= from.getTime() &&
    isSameLocalDay(to, now)
  );
}

/**
 * Report the live `*.today` energy on top of the per-hour cost totals for the
 * current-day window: replace the energy kWh figures with the live values
 * (only the fields the reader supplied) and RECOMPUTE the pure derived-energy /
 * ratio fields from them — mirroring {@link allocateCost}'s formulas exactly so
 * the tiles stay coherent.
 *
 * Deliberate split: the MONEY fields (importCost, exportEarnings,
 * standingCharge, net, gridOnlyCost, savings, solarSavings, byDay, byBand) pass
 * through untouched. They are priced per-hour-of-day tariff band from the
 * `*.total` deltas and stay authoritative for money — a day register can't be
 * banded — so the reported kWh and its priced cost may diverge slightly while
 * the day is in progress.
 */
function reportLiveTodayTotals(totals: CostTotals, today: Partial<EnergyTotals>): CostTotals {
  const importKwh = today.importKwh ?? totals.importKwh;
  const exportKwh = today.exportKwh ?? totals.exportKwh;
  const loadKwh = today.loadKwh ?? totals.loadKwh;
  const productionKwh = today.productionKwh ?? totals.productionKwh;
  return {
    ...totals,
    importKwh,
    exportKwh,
    loadKwh,
    productionKwh,
    batteryDischargeKwh: today.batteryDischargeKwh ?? totals.batteryDischargeKwh,
    batteryChargeKwh: today.batteryChargeKwh ?? totals.batteryChargeKwh,
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
    import("./spot-price-settings"),
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
  const hours = await fetchHourlyEnergy(profile, inverterId, opts.from, opts.to);
  const rangeDays = Math.max(0, (opts.to.getTime() - opts.from.getTime()) / 86_400_000);
  const totals = allocateCost(
    hours,
    tariff,
    rangeDays,
    await zeroValueShareFor(tariff, opts.from, opts.to),
  );

  // Current-day window only: report the ENERGY kWh from the live *.today
  // registers (which lead the coarse cross-bucket *.total delta for the
  // in-progress day, matching the dashboard headline), recomputing the ratios
  // from them. Money stays per-hour (see reportLiveTodayTotals). Month/year
  // windows: no override — the today portion is negligible and can't be cleanly
  // separated from the window's *.total delta.
  const now = new Date();
  const reported = isTodayWindow(opts.from, opts.to, now)
    ? reportLiveTodayTotals(totals, liveTodayTotals(profile, inverterId, now))
    : totals;

  return {
    currency: tariff.currency,
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    ...reported,
  };
}
