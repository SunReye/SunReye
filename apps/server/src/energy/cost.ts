/**
 * Cost engine: turns stored energy flows into money using the active tariff.
 *
 * Energy comes from the rollup reader ({@link ./rollup-reader}), which owns the
 * counter deltas, the register choice and their SQL. This module owns pricing
 * orchestration only: the window's hours priced per tariff band, the standing
 * charge prorated per period, the live `*.today` registers swapped into today's
 * slice, and §51's worthless export. The arithmetic itself is pure and
 * unit-tested in {@link ./cost-calc}.
 */

import type {
  CostBreakdown,
  CostTotals,
  EnergyTotals,
  HourEnergy,
} from "@SunReye/contracts/energy";
import { type TariffConfig, importPriceForHour } from "@SunReye/db/tariff";
import type { InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { zoneParts } from "@SunReye/inverter-core/zone-parts";
import { dateKey, dayStart, isoWeekday } from "@SunReye/inverter-core/zoned-calendar";
import type { SeriesTarget } from "../shared/plant-source";
import {
  type FallbackRates,
  type ZeroValueShare,
  allocateCost,
  priceSeriesRows,
  repriceTodaySlice,
  rollUpToMonths,
} from "./cost-calc";
import { impliedLoadKwh, replaceTodaySlice } from "./energy-calc";
import { type CostBucket, eachPeriod } from "./period-keys";
import {
  type RollupReader,
  dbRollupReader,
  liveTodayTotals,
  metersLoadEnergy,
} from "./rollup-reader";
import { getPlantTimeZone } from "../settings/display-settings";
import { getTariff } from "../settings/settings";
import { liveState } from "../shared/state";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export { resolveRange } from "./cost-calc";

/**
 * What a request prices against, resolved ONCE per request: the plant zone that
 * buckets it (never `display.timeZone`, which only renders), the tariff, and the
 * device or plant being priced.
 */
export interface PlantContext {
  tz: string;
  tariff: TariffConfig;
  target: SeriesTarget;
}

/** The {@link PlantContext} for `target` (the profile's own device when absent). */
export async function resolvePlantContext(
  profile: InverterProfile,
  target?: SeriesTarget,
): Promise<PlantContext> {
  const [tz, tariff] = await Promise.all([getPlantTimeZone(), getTariff()]);
  return { tz, tariff, target: target ?? profile.id };
}

/** One stored day-ahead slot, as far as §51 reads it. */
export interface SpotSlot {
  slotStart: Date;
  eurPerMwh: number;
}

/** Everything pricing reads besides the {@link PlantContext}. Each has a live default. */
export interface CostSources {
  reader: RollupReader;
  /** Stored day-ahead slots in `[from, to)` for the plant's bidding zone. */
  spotSlots(from: Date, to: Date): Promise<SpotSlot[]>;
  /** The poll cache's latest sample. */
  liveSample(): InverterSample | null;
  now(): Date;
}

/** Stored slots through the price store, in the plant's configured bidding zone. */
async function storedSpotSlots(from: Date, to: Date): Promise<SpotSlot[]> {
  const [{ getSpotPrices }, { getSpotPriceConfig }] = await Promise.all([
    import("@SunReye/db/spot-price"),
    import("../settings/spot-price-settings"),
  ]);
  return getSpotPrices((await getSpotPriceConfig()).zone, from, to);
}

const liveSources: CostSources = {
  reader: dbRollupReader,
  spotSlots: storedSpotSlots,
  liveSample: () => liveState.latest,
  now: () => new Date(),
};

/** A request's context and sources; anything absent is resolved live. */
export type CostDeps = Partial<CostSources> & { context?: PlantContext };

async function resolveDeps(
  profile: InverterProfile,
  target: SeriesTarget | undefined,
  deps: CostDeps,
): Promise<{ ctx: PlantContext; src: CostSources }> {
  const ctx = deps.context ?? (await resolvePlantContext(profile, target));
  return { ctx, src: { ...liveSources, ...deps } };
}

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
  now: Date,
  tz: string,
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
 * accurate and zero-filled. Reads the bounded counter-delta matrix
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
  opts: { from: Date; to: Date; bucket: CostBucket; inverterId?: SeriesTarget },
  deps: CostDeps = {},
): Promise<CostSeriesPoint[]> {
  const { ctx, src } = await resolveDeps(profile, opts.inverterId, deps);
  const { tariff, tz } = ctx;
  const zeroValueShare = await zeroValueShareFor(tariff, opts.from, opts.to, src.spotSlots);
  const rollUp = zeroValueShare !== undefined && opts.bucket === "month";
  const bucket = rollUp ? "day" : opts.bucket;

  const { rows, fieldByKey, periods } = await src.reader.counterDeltaMatrix(profile, {
    from: opts.from,
    to: opts.to,
    inverterId: ctx.target,
    bucket,
    view: "hourly_rollups",
    tz,
  });
  const standing = standingByPeriod(
    opts.from,
    opts.to,
    bucket,
    tariff.standingChargeMonthly,
    src.now(),
    tz,
  );
  const points = priceSeriesRows(rows, fieldByKey, periods, tariff, standing, zeroValueShare);
  return rollUp ? rollUpToMonths(points) : points;
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
function coversTodaySoFar(from: Date, to: Date, now: Date, tz: string): boolean {
  const midnight = dayStart(now, tz);
  return (
    from.getTime() <= midnight.getTime() && (to >= now || dateKey(to, tz) === dateKey(now, tz))
  );
}

/** The hours of a window that fall on or after `midnight` — today's slice. */
function hoursSince(hours: HourEnergy[], midnight: Date): HourEnergy[] {
  return hours.filter((h) => h.time.getTime() >= midnight.getTime());
}

/** The tariff's own per-kWh rates at `now` — what prices a register the counter
 *  deltas have not seen yet (see {@link repriceTodaySlice}). */
function fallbackRatesAt(tariff: TariffConfig, now: Date, tz: string): FallbackRates {
  return {
    importPrice: importPriceForHour(tariff, zoneParts(tz, now.getTime()).hour, isoWeekday(now, tz)),
    exportPrice: tariff.export.feedInPerKwh,
  };
}

/**
 * Report the live `*.today` registers on top of a window's per-hour cost totals:
 * exchange today's delta-derived slice for the live registers (only the fields
 * the reader supplied), RECOMPUTE the pure derived-energy / ratio fields from
 * the result — mirroring {@link allocateCost}'s formulas exactly so the tiles
 * stay coherent — and move today's MONEY with the energy.
 *
 * `slice` is today's own contribution to `totals` (energy and money alike, as
 * {@link allocateCost} priced it), so a month-to-date window keeps its earlier
 * days and only its today slice moves. For the `today` window itself that slice
 * IS the whole window, and this reduces to a plain replacement.
 *
 * The money moves at the slice's effective rate (see {@link repriceTodaySlice}):
 * the per-hour banding the deltas established is kept, and the register's kWh
 * are priced like the recorded part of the day. Before this the money stayed
 * on the deltas alone, and the dashboard read a day's kWh beside an hour's
 * euros. `byDay` and `byBand` stay on the deltas — a day register cannot be
 * apportioned to a band.
 *
 * `impliedLoad` says the plant meters no consumption at all
 * ({@link metersLoadEnergy}), so its house figure is derived rather than read.
 */
function reportLiveTodayTotals(
  totals: CostTotals,
  today: Partial<EnergyTotals>,
  slice: CostTotals,
  impliedLoad: boolean,
  fallback: FallbackRates,
): CostTotals {
  const swapped = replaceTodaySlice(totals, slice, today);
  // The live slice on its own: what the registers say happened today.
  const liveSlice = replaceTodaySlice(slice, slice, today);
  // An implied consumption has to be re-implied from the swapped flows: it was
  // computed per hour off the counter deltas, and leaving it there would report
  // a house figure that contradicts the import/export/production printed beside
  // it. A metered plant has nothing to re-derive.
  const energy = impliedLoad ? { ...swapped, loadKwh: impliedLoadKwh(swapped) } : swapped;
  const live = impliedLoad ? { ...liveSlice, loadKwh: impliedLoadKwh(liveSlice) } : liveSlice;
  const { importKwh, exportKwh, loadKwh, productionKwh } = energy;
  return {
    ...repriceTodaySlice({ ...totals, ...energy }, slice, live, fallback),
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
 * The counter-delta matrix groups by (period, hour-of-day, weekday), and at
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
  spotSlots: CostSources["spotSlots"],
): Promise<ZeroValueShare | undefined> {
  if (tariff.export.mode !== "spot" || tariff.export.spot.marketingModel !== "eegFeedIn") {
    return undefined;
  }
  const rows = await spotSlots(from, to);
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
    inverterId?: SeriesTarget;
  },
  deps: CostDeps = {},
): Promise<CostBreakdown> {
  const { ctx, src } = await resolveDeps(profile, opts.inverterId, deps);
  const { tariff, tz, target } = ctx;
  const hours = await src.reader.bucketEnergy(
    profile,
    target,
    opts.from,
    opts.to,
    "hourly_rollups",
    tz,
  );
  const rangeDays = Math.max(0, (opts.to.getTime() - opts.from.getTime()) / 86_400_000);
  const zeroValueShare = await zeroValueShareFor(tariff, opts.from, opts.to, src.spotSlots);
  const totals = allocateCost(hours, tariff, rangeDays, zeroValueShare, tz);

  // Any window running up to now — today, month-to-date, year-to-date — reports
  // today's kWh from the live *.today registers, which lead the coarse
  // cross-bucket *.total delta for the in-progress day and match the dashboard
  // headline; the ratios are recomputed from the result and today's money moves
  // with its kWh (see reportLiveTodayTotals). The slice is exchanged, not the
  // total, so a month can never report less energy than the day inside it.
  const now = src.now();
  const reported = coversTodaySoFar(opts.from, opts.to, now, tz)
    ? reportLiveTodayTotals(
        totals,
        liveTodayTotals(profile, target, tz, now, src.liveSample()),
        // Today's slice priced exactly as the window priced it (no standing
        // charge: that is the window's, prorated once).
        allocateCost(hoursSince(hours, dayStart(now, tz)), tariff, 0, zeroValueShare, tz),
        !metersLoadEnergy(profile),
        fallbackRatesAt(tariff, now, tz),
      )
    : totals;

  return {
    currency: tariff.currency,
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    ...reported,
  };
}
