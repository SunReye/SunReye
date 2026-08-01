/**
 * Day-ahead price sync — the impure side of {@link ./spot-price} (the calendar and
 * shaping math live there; DB rows in {@link @SunReye/db/spot-price}; the read-path
 * loader in {@link ./spot-price-store}).
 *
 * **There is no cursor, and that is the design.** Unlike the forecast-correction
 * job, the window this wants is always "today and tomorrow in market-local time",
 * and the upserts are idempotent — so the stored rows *are* the cursor.
 * Completeness is a count compared against the delivery day's expected slot
 * count, which makes the "failure never advances the cursor" invariant hold by
 * construction: a throw writes nothing and the next tick retries the identical
 * window. A `spot_price_state` table would only add a second thing to keep in
 * sync with the rows.
 *
 * On timing: the D+1 auction clears around 12:45–13:10 market time, but that is
 * not a contract — it slips, and on a coupling incident it can be much later. A
 * timer aimed at 13:00 would therefore turn a 20-minute delay into a 24-hour
 * outage, which matters in a codebase with no retry/backoff anywhere. So this
 * polls on a plain interval and no-ops once both days are complete: the interval
 * *is* the retry, and it also self-heals a 03:00 boot, a DST seam and a zone
 * change for free.
 */

import type { SpotPriceConfig } from "@SunReye/db/spot-price-config";
import { spotPricesReady } from "@SunReye/db/spot-price-config";
import { countSpotPrices, upsertSpotPrices } from "@SunReye/db/spot-price";
import type { TariffConfig } from "@SunReye/db/tariff";
import { exportPriceForSlot, importPriceAt } from "@SunReye/db/tariff";
import { getTariff } from "./settings";
import { log } from "./logging";
import {
  type SlotCoverage,
  type SpotPricePoint,
  type SpotPriceProvider,
  SLOT_MINUTES,
  SpotPriceUnpublished,
  type SpotSlice,
  expectedSlotCount,
  localDayStartMs,
  nextLocalDayStartMs,
  toSpotRows,
  zoneTimeZone,
} from "./spot-price";
import { invalidateSpotSlice, loadSpotSlice } from "./spot-price-store";
import { energyChartsPrices } from "./spot-providers/energy-charts";

const logger = log("spot-price");

/**
 * Registered price sources, keyed by id. An unknown id in the config warns and
 * degrades to "no prices" rather than throwing — the same contract the irradiance
 * registry uses, so a config written by a newer version doesn't break a rollback.
 */
const PROVIDERS: Record<string, SpotPriceProvider> = {
  [energyChartsPrices.id]: energyChartsPrices,
};

/** Provider ids and the zones each serves — drives the settings form. */
export function spotProviderCatalog(): {
  id: string;
  zones: readonly string[];
  attribution: string;
}[] {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    zones: p.zones,
    attribution: p.attribution,
  }));
}

/** The attribution line for the configured provider, or null when unknown. */
function spotAttribution(config: SpotPriceConfig): string | null {
  return PROVIDERS[config.provider]?.attribution ?? null;
}

/** The two market-local delivery days this job keeps stocked. */
function syncWindow(
  zone: string,
  nowMs: number,
): { todayMs: number; tomorrowMs: number; endMs: number } {
  const tz = zoneTimeZone(zone);
  const todayMs = localDayStartMs(tz, nowMs);
  const tomorrowMs = nextLocalDayStartMs(tz, nowMs);
  return { todayMs, tomorrowMs, endMs: nextLocalDayStartMs(tz, tomorrowMs) };
}

/** Stored-vs-expected coverage for one delivery day. */
async function coverageFor(zone: string, fromMs: number, toMs: number): Promise<SlotCoverage> {
  const stored = await countSpotPrices(zone, new Date(fromMs), new Date(toMs));
  if (stored <= 0) return "missing";
  return stored >= expectedSlotCount(fromMs, toMs, SLOT_MINUTES) ? "complete" : "partial";
}

export type SpotSyncOutcome =
  | "disabled"
  | "unknown-provider"
  | "complete"
  | "stored"
  | "unpublished"
  | "failed";

export interface SpotSyncResult {
  outcome: SpotSyncOutcome;
  /** Slots written this run. */
  stored: number;
}

/**
 * Fetch and store today+tomorrow when anything is missing.
 *
 * Idempotent and safe to call as often as the interval fires: with both days
 * complete it costs one indexed count and no network at all.
 */
export async function runSpotPriceSync(
  config: SpotPriceConfig,
  nowMs: number = Date.now(),
): Promise<SpotSyncResult> {
  if (!spotPricesReady(config)) return { outcome: "disabled", stored: 0 };
  const provider = PROVIDERS[config.provider];
  if (!provider) {
    logger.warn("unknown spot price provider {provider}", { provider: config.provider });
    return { outcome: "unknown-provider", stored: 0 };
  }

  const { zone } = config;
  const { todayMs, tomorrowMs, endMs } = syncWindow(zone, nowMs);
  const [today, tomorrow] = await Promise.all([
    coverageFor(zone, todayMs, tomorrowMs),
    coverageFor(zone, tomorrowMs, endMs),
  ]);
  if (today === "complete" && tomorrow === "complete") return { outcome: "complete", stored: 0 };

  try {
    const series = await provider.fetch(zone, todayMs, endMs);
    const rows = toSpotRows(series, provider.id);
    await upsertSpotPrices(rows);
    invalidateSpotSlice();
    logger.info("stored {n} price slots for {zone} at {resolution} min resolution", {
      n: rows.length,
      zone,
      resolution: series.resolutionMinutes,
    });
    return { outcome: "stored", stored: rows.length };
  } catch (error) {
    // Not yet published is the expected state before the auction clears, so it
    // must not read as a failure in the log every half hour.
    if (error instanceof SpotPriceUnpublished) {
      logger.debug("day-ahead prices not published yet for {zone}: {error}", { zone, error });
      return { outcome: "unpublished", stored: 0 };
    }
    logger.warn("spot price sync failed for {zone}: {error}", { zone, error });
    return { outcome: "failed", stored: 0 };
  }
}

/**
 * A market slot with the money applied: what a kWh imported then costs, and what
 * a kWh exported then earns, both under the active tariff.
 */
export type PricedSlot = SpotPricePoint & {
  /** Landed import price for the slot, currency-major per kWh. */
  importPerKwh: number;
  /** Export remuneration for the slot, currency-major per kWh. Can be 0 (§51). */
  exportPerKwh: number;
};

/**
 * Apply the tariff to every slot.
 *
 * The hour/weekday are taken from the slot's own market-local label, so a static
 * or fallback band lands on the right time-of-use window without re-deriving the
 * calendar.
 */
function priceSlots(slice: SpotSlice, tariff: TariffConfig): PricedSlot[] {
  return slice.series.map((p) => {
    const hour = Number(p.time.slice(11, 13));
    const isoWeekday = ((new Date(p.startMs).getUTCDay() + 6) % 7) + 1;
    return {
      ...p,
      importPerKwh: importPriceAt(tariff, p.eurPerMwh, hour, isoWeekday),
      exportPerKwh: exportPriceForSlot(tariff, p.eurPerMwh),
    };
  });
}

/** One priced slot as the API returns it. */
export interface SpotPriceView {
  provider: string;
  zone: string;
  /** Credit line the UI must render (CC BY 4.0 for the default source). */
  attribution: string | null;
  /**
   * Coarsest source resolution present, minutes. 60 means at least some slots
   * came from an hourly source, so a negative quarter-hour inside a positive hour
   * could not be resolved.
   */
  resolutionMinutes: number;
  utcOffsetSeconds: number;
  coverage: SpotSlice["coverage"];
  availability: SpotSlice["availability"];
  series: PricedSlot[];
  /** Cheapest/priciest slot of the whole slice, EUR/MWh; null when empty. */
  extremes: { minEurPerMwh: number; maxEurPerMwh: number } | null;
  /**
   * Count of negative slots per day. Read together with `coverage` — a 0 for a
   * day that is `"missing"` means *unknown*, not "none".
   */
  negativeSlots: { today: number; tomorrow: number };
}

/**
 * The current price picture, or null when the feature is off / unconfigured /
 * has no data at all — mirroring how `/api/weather` degrades.
 */
export async function getSpotPriceView(
  config: SpotPriceConfig,
  nowMs: number = Date.now(),
): Promise<SpotPriceView | null> {
  if (!spotPricesReady(config)) return null;
  const slice = await loadSpotSlice(config.zone, nowMs);
  if (slice.series.length === 0) return null;

  const tz = zoneTimeZone(config.zone);
  const tomorrowMs = nextLocalDayStartMs(tz, nowMs);
  const prices = slice.series.map((p) => p.eurPerMwh);
  const series = priceSlots(slice, await getTariff());

  return {
    provider: config.provider,
    zone: config.zone,
    attribution: spotAttribution(config),
    resolutionMinutes: Math.max(...slice.series.map((p) => p.minutes)),
    utcOffsetSeconds: slice.utcOffsetSeconds,
    coverage: slice.coverage,
    availability: slice.availability,
    series,
    extremes: { minEurPerMwh: Math.min(...prices), maxEurPerMwh: Math.max(...prices) },
    negativeSlots: {
      today: slice.series.filter((p) => p.negative && p.startMs < tomorrowMs).length,
      tomorrow: slice.series.filter((p) => p.negative && p.startMs >= tomorrowMs).length,
    },
  };
}
