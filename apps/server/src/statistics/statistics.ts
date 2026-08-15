/**
 * Statistics page DB-bound orchestration: reads the bounded counter-delta
 * matrix ({@link ../energy/cost}) and hands the pure folds in
 * {@link ./statistics-calc} their inputs. Route wiring lives in
 * {@link ../routes/statistics}.
 */

import type { EnergyField } from "@SunReye/contracts/energy";
import type {
  CompareMode,
  ComparisonResponse,
  EnergyRecords,
  HeatmapCell,
  MoneyRecords,
  RecordsResponse,
  StatisticsTodayMessage,
} from "@SunReye/contracts/statistics";
import { db } from "@SunReye/db";
import type { InverterProfile } from "@SunReye/inverter-core";
import { sql } from "drizzle-orm";
import {
  ENERGY_FIELDS,
  computeCost,
  computeCostSeries,
  currentPeriodKey,
  fetchCounterDeltaMatrix,
  resolveRange,
} from "../energy/cost";
import { accumulateTotals, emptyTotals, energySeries } from "../energy/energy";
import { derivePeriodEnergy } from "../energy/energy-calc";
import { startOfZonedDay } from "../energy/zoned-time";
import { getPlantTimeZone } from "../settings/display-settings";
import { getTariff } from "../settings/settings";
import {
  heatmapCells,
  hodDowOccurrences,
  pickEnergyRecords,
  pickMoneyRecords,
  previousWindow,
} from "./statistics-calc";

const DAY_MS = 86_400_000;

/** `hourly_rollups` retention horizon (days) — hourly-sourced windows clamp
 *  to it so a wider request degrades to the covered range instead of showing
 *  silently-empty cells. */
const HOURLY_RETENTION_DAYS = 730;

/** `from` clamped to the hourly-rollup retention horizon. */
function clampToHourlyRetention(from: Date, now: Date = new Date()): Date {
  const min = new Date(now.getTime() - HOURLY_RETENTION_DAYS * DAY_MS);
  return from < min ? min : from;
}

/** Every energy field the cost engine knows, as a runtime list — cells carry
 *  all of them (zero-filled) even when the profile maps only a subset, so the
 *  client can switch metric without refetching. */
const ALL_ENERGY_FIELDS = Object.keys(ENERGY_FIELDS) as EnergyField[];

/**
 * Hour×weekday energy heatmap over `[from, to)` (clamped to the hourly
 * retention horizon): ≤168 cells, each summing the window's kWh per energy
 * field for one local (hour-of-day, ISO weekday) slot, plus the calendar
 * occurrence count the client averages by. The matrix is read at month
 * periods purely to bound the row count — the fold ignores the period.
 */
export async function computeHeatmap(
  profile: InverterProfile,
  opts: { from: Date; to: Date; inverterId?: string },
): Promise<HeatmapCell[]> {
  const from = clampToHourlyRetention(opts.from);
  const tz = await getPlantTimeZone();
  const { rows, fieldByKey } = await fetchCounterDeltaMatrix(profile, {
    from,
    to: opts.to,
    bucket: "month",
    inverterId: opts.inverterId,
    view: "hourly_rollups",
    tz,
  });
  return heatmapCells(rows, fieldByKey, ALL_ENERGY_FIELDS, hodDowOccurrences(from, opts.to, tz));
}

/** Earliest daily-rollup bucket for an inverter — the start of recorded
 *  history. `daily_rollups` is retained forever, so this is the true first
 *  day of data. */
async function earliestDailyBucket(inverterId: string): Promise<Date | null> {
  const res = await db.execute<{ first: string | Date | null }>(sql`
    select min(bucket) as first
    from daily_rollups
    where inverter_id = ${inverterId}
  `);
  const first = res.rows[0]?.first;
  return first ? new Date(first) : null;
}

/**
 * Cost breakdowns for `[from, to)` and its {@link previousWindow} reference,
 * side by side. Both run server-side in one request so a §51 spot-price load
 * happens once per window here instead of twice client-side, and the live
 * today-override applies only when the CURRENT window is a true today window
 * (the reference window never is).
 */
export async function computeComparison(
  profile: InverterProfile,
  opts: { from: Date; to: Date; mode: CompareMode; inverterId?: string },
): Promise<ComparisonResponse> {
  const inverterId = opts.inverterId ?? profile.id;
  const prev = previousWindow(opts.from, opts.to, opts.mode);
  const [current, previous, dataFrom] = await Promise.all([
    computeCost(profile, { from: opts.from, to: opts.to, inverterId }),
    computeCost(profile, { from: prev.from, to: prev.to, inverterId }),
    earliestDailyBucket(inverterId),
  ]);
  return {
    mode: opts.mode,
    current,
    previous,
    coverage: { dataFrom: dataFrom?.toISOString() ?? null },
  };
}

/** Midnight starting the current plant-local day (as a UTC instant), in zone `tz`. */
function startOfLocalDay(now: Date, tz: string): Date {
  return startOfZonedDay(now, tz);
}

// Records deliberately exclude the in-progress day, so a result only changes
// at local midnight (or when history is reset) — cache one result per
// inverter, keyed by the local day it was computed on.
const recordsCache = new Map<string, { day: string; value: RecordsResponse }>();

/** All-time per-day records (cached per inverter per local day). */
export async function computeRecords(
  profile: InverterProfile,
  opts: { inverterId?: string } = {},
): Promise<RecordsResponse> {
  const inverterId = opts.inverterId ?? profile.id;
  const tz = await getPlantTimeZone();
  const day = currentPeriodKey("day", new Date(), tz);
  const hit = recordsCache.get(inverterId);
  if (hit && hit.day === day) return hit.value;
  const value = await buildRecords(profile, inverterId, tz);
  recordsCache.set(inverterId, { day, value });
  return value;
}

/** Uncached records build over `[first day of data, today midnight)`. */
async function buildRecords(
  profile: InverterProfile,
  inverterId: string,
  tz: string,
): Promise<RecordsResponse> {
  const firstDay = await earliestDailyBucket(inverterId);
  const to = startOfLocalDay(new Date(), tz);
  if (!firstDay || firstDay >= to) return { energy: null, money: null };
  const [energy, money] = await Promise.all([
    energyRecords(profile, inverterId, firstDay, to, tz),
    moneyRecords(profile, inverterId, firstDay, to),
  ]);
  return { energy, money };
}

/** Energy records over the FULL history: per-day splits from the forever-
 *  retained daily rollups, folded with the same helpers the energy series
 *  uses, then reduced to records by the pure picker. */
async function energyRecords(
  profile: InverterProfile,
  inverterId: string,
  from: Date,
  to: Date,
  tz: string,
): Promise<EnergyRecords> {
  const { rows, fieldByKey, periods } = await fetchCounterDeltaMatrix(profile, {
    from,
    to,
    bucket: "day",
    inverterId,
    view: "daily_rollups",
    tz,
  });
  const totals = accumulateTotals(rows, fieldByKey, periods);
  const days = periods.map((p) => derivePeriodEnergy(p, totals.get(p) ?? emptyTotals()));
  return { since: from.toISOString(), ...pickEnergyRecords(days) };
}

/**
 * Today's cost breakdown and energy split. Cheap by construction — 24 hourly
 * buckets plus the live `*.today` register override — so republishing it every
 * few seconds costs about what one dashboard read does.
 */
export async function todayStatistics(
  profile: InverterProfile,
  inverterId?: string,
): Promise<StatisticsTodayMessage> {
  const { from, to } = resolveRange("today");
  const [cost, periods, tz] = await Promise.all([
    computeCost(profile, { from, to, inverterId }),
    energySeries(profile, { from, to, bucket: "day", inverterId }),
    getPlantTimeZone(),
  ]);
  return {
    type: "today",
    at: new Date().toISOString(),
    cost,
    // A day with no rollup bucket yet (just past midnight) still gets a
    // zero-filled period, so the client never has to handle a missing split.
    energy:
      periods[0] ?? derivePeriodEnergy(currentPeriodKey("day", new Date(), tz), emptyTotals()),
  };
}

/** Money records over the band-priceable history: the per-day cost series
 *  needs hourly data, so its window (and the reported `since`) clamps to the
 *  hourly-rollup retention horizon. */
async function moneyRecords(
  profile: InverterProfile,
  inverterId: string,
  firstDay: Date,
  to: Date,
): Promise<MoneyRecords> {
  const since = clampToHourlyRetention(firstDay);
  const [tariff, points] = await Promise.all([
    getTariff(),
    computeCostSeries(profile, { from: since, to, bucket: "day", inverterId }),
  ]);
  return { since: since.toISOString(), currency: tariff.currency, ...pickMoneyRecords(points) };
}
