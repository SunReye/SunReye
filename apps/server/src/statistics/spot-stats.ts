/**
 * Spot-price analytics orchestration: reads the stored day-ahead slots (daily
 * shape aggregated in SQL, the raw pass bounded) plus the plant's hourly import,
 * and hands the pure folds in {@link ./spot-stats-calc} their inputs. Route
 * wiring lives in {@link ../routes/statistics}.
 */

import type { SpotStats } from "@SunReye/contracts/prices";
import { db } from "@SunReye/db";
import { getSpotPrices } from "@SunReye/db/spot-price";
import { spotPricesReady } from "@SunReye/db/spot-price-config";
import type { InverterProfile } from "@SunReye/inverter-core";
import { sql } from "drizzle-orm";
import { fetchBucketEnergy } from "../energy/cost";
import { getPlantTimeZone } from "../settings/display-settings";
import { getTariff } from "../settings/settings";
import { getSpotPriceConfig } from "../settings/spot-price-settings";
import {
  type SpotDailyRow,
  type SpotPriceSlot,
  groupNegativeWindows,
  hourlyAveragePrices,
  paidVsMarket,
  spotDailyStats,
  spotWhatIf,
} from "./spot-stats-calc";

const DAY_MS = 86_400_000;

/**
 * Horizon of the raw-slot pass (negative-window grouping + the hour→price map),
 * which necessarily ships every stored slot. 400 days is ~38k rows — the same
 * order the §51 pricing path already loads for a year. The daily series is
 * aggregated in SQL and covers the full requested window regardless.
 */
const RAW_MAX_DAYS = 400;

/**
 * Per-day price shape for one zone over `[from, to)`, grouped by LOCAL calendar
 * day (server tz, like every other statistics period key). Bounded by the
 * calendar rather than by slot count, so a multi-year window is still one small
 * result set. Sums of `price·minutes` come back so the caller can average by
 * slot width instead of by slot count.
 */
async function fetchDailyPriceRows(
  zone: string,
  from: Date,
  to: Date,
  tz: string,
): Promise<SpotDailyRow[]> {
  const res = await db.execute<{
    date: string;
    min_eur: number;
    max_eur: number;
    slots: number;
    negative_slots: number;
    price_minutes: number;
    minutes: number;
    negative_minutes: number;
  }>(sql`
    select
      to_char(date_trunc('day', slot_start at time zone ${tz}), 'YYYY-MM-DD') as date,
      min(eur_per_mwh) as min_eur,
      max(eur_per_mwh) as max_eur,
      count(*)::int as slots,
      count(*) filter (where eur_per_mwh < 0)::int as negative_slots,
      sum(eur_per_mwh * slot_minutes) as price_minutes,
      sum(slot_minutes) as minutes,
      coalesce(sum(slot_minutes) filter (where eur_per_mwh < 0), 0) as negative_minutes
    from spot_prices
    where zone = ${zone}
      and slot_start >= ${from}
      and slot_start < ${to}
    group by 1
    order by 1
  `);
  return res.rows.map((r) => ({
    date: r.date,
    minEurPerMwh: Number(r.min_eur),
    maxEurPerMwh: Number(r.max_eur),
    slots: Number(r.slots),
    negativeSlots: Number(r.negative_slots),
    priceMinutes: Number(r.price_minutes),
    minutes: Number(r.minutes),
    negativeMinutes: Number(r.negative_minutes),
  }));
}

/** The raw slots of `[from, to)`, reduced to what the pure folds read. */
async function fetchPriceSlots(zone: string, from: Date, to: Date): Promise<SpotPriceSlot[]> {
  const rows = await getSpotPrices(zone, from, to);
  return rows.map((r) => ({
    startMs: new Date(r.slotStart).getTime(),
    minutes: r.slotMinutes,
    eurPerMwh: r.eurPerMwh,
  }));
}

/**
 * Market behaviour over `[from, to)` and what it meant for this plant, or null
 * when the price feed isn't configured — the whole statistics section then has
 * nothing to render and hides itself.
 */
export async function computeSpotStats(
  profile: InverterProfile,
  opts: { from: Date; to: Date; inverterId?: string },
): Promise<SpotStats | null> {
  const config = await getSpotPriceConfig();
  if (!spotPricesReady(config)) return null;
  const { zone } = config;
  const inverterId = opts.inverterId ?? profile.id;
  // The energy side is read over the same (possibly truncated) window as the
  // prices, so paid-vs-market and the what-if never mix priced and unpriced eras.
  const rawFrom = new Date(
    Math.max(opts.from.getTime(), opts.to.getTime() - RAW_MAX_DAYS * DAY_MS),
  );

  const tz = await getPlantTimeZone();
  const [tariff, dailyRows, slots, hours] = await Promise.all([
    getTariff(),
    fetchDailyPriceRows(zone, opts.from, opts.to, tz),
    fetchPriceSlots(zone, rawFrom, opts.to),
    fetchBucketEnergy(profile, inverterId, rawFrom, opts.to, "hourly_rollups"),
  ]);

  const { daily, summary } = spotDailyStats(dailyRows);
  const priceByHour = hourlyAveragePrices(slots);
  return {
    zone,
    currency: tariff.currency,
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    summary,
    daily,
    negativeWindows: groupNegativeWindows(slots),
    negativeWindowsTruncated: rawFrom.getTime() > opts.from.getTime(),
    paidVsMarket: paidVsMarket(hours, priceByHour),
    whatIf: spotWhatIf(hours, tariff, priceByHour),
  };
}
