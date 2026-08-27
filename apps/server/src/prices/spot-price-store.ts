/**
 * Loader for the stored day-ahead price series.
 *
 * Exists as its own module for the same reason `./forecast-correction-store` does:
 * both the read path (routes, automations) and the write path
 * ({@link ./spot-price-job}) need "give me the current slice", and the read path
 * must not pull the job's provider/network graph in behind it.
 *
 * The series itself lives in Postgres, so the short TTL here is only about not
 * making a DB round trip on every automation tick — it is a render cache, not the
 * source of truth, and the job invalidates it after a successful sync.
 */

import type { SpotSlice } from "@SunReye/contracts/prices";
import { getSpotPrices } from "@SunReye/db/spot-price";
import { buildSpotSlice, localDayStartMs, nextLocalDayStartMs, zoneTimeZone } from "./spot-price";

const CACHE_TTL_MS = 60_000;

let cache: { zone: string; at: number; slice: SpotSlice } | null = null;

/**
 * Today + tomorrow (market-local) for one zone. Always returns a slice; when
 * nothing is stored it is an empty one whose `availability` is `"none"` — the
 * caller must branch on that rather than reading an empty series as "no negative
 * slots".
 */
export async function loadSpotSlice(zone: string, nowMs: number = Date.now()): Promise<SpotSlice> {
  if (cache && cache.zone === zone && nowMs - cache.at < CACHE_TTL_MS) return cache.slice;
  const tz = zoneTimeZone(zone);
  const from = localDayStartMs(tz, nowMs);
  const to = nextLocalDayStartMs(tz, nextLocalDayStartMs(tz, nowMs));
  const rows = await getSpotPrices(zone, new Date(from), new Date(to));
  const slice = buildSpotSlice(rows, zone, nowMs);
  cache = { zone, at: nowMs, slice };
  return slice;
}

/** Drop the cached slice (called after a sync writes new slots). */
export function invalidateSpotSlice(): void {
  cache = null;
}
