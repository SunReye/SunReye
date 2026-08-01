/**
 * Day-ahead price provider backed by aWATTar's public market-data endpoint.
 *
 * Keyless like the default, and useful to aWATTar/tado customers who want to see
 * the curve their own supplier bills against. It is **not** the default, for one
 * disqualifying reason: it publishes **hourly** prices only — `?resolution=
 * quarterhourly` is accepted and silently ignored — so a negative quarter-hour
 * sitting inside a net-positive hour is invisible to it. That is precisely the
 * case §51 EEG turns on, so a plant relying on this source would miss exactly the
 * slots the feature exists to find.
 *
 * The hourly values are fanned out onto the quarter-hour grid on ingest, but the
 * stored `slot_minutes` stays 60 so the UI can say what was lost rather than
 * imply a precision the data never had.
 *
 * Two market areas, on two hosts: `.de` serves DE-LU, `.at` serves AT.
 */

import { type SpotPriceProvider, type SpotPriceSeries, SpotPriceUnpublished } from "../spot-price";
import { fetchSpotJson } from "./shared";

const HOST_BY_ZONE: Record<string, string> = {
  "DE-LU": "https://api.awattar.de/v1/marketdata",
  AT: "https://api.awattar.at/v1/marketdata",
};

interface AwattarEntry {
  start_timestamp?: number;
  end_timestamp?: number;
  marketprice?: number | null;
  unit?: string;
}

interface AwattarResponse {
  data?: AwattarEntry[];
}

/** aWATTar quotes `Eur/MWh`; anything else would silently misprice. */
function assertUnit(unit: string | undefined): void {
  const normalized = (unit ?? "").replace(/\s+/g, "").toLowerCase();
  if (normalized !== "eur/mwh") throw new Error(`unexpected price unit "${unit}"`);
}

/** Nominal slot width from the first entry's own bounds, minutes. */
function resolutionMinutes(entries: AwattarEntry[]): number {
  const first = entries[0];
  if (first?.start_timestamp === undefined || first.end_timestamp === undefined) return 60;
  const minutes = Math.round((first.end_timestamp - first.start_timestamp) / 60_000);
  return minutes > 0 ? minutes : 60;
}

/** An entry both of whose halves are usable. */
function usable(entry: AwattarEntry): entry is AwattarEntry & {
  start_timestamp: number;
  marketprice: number;
} {
  const { marketprice: price, start_timestamp: start } = entry;
  if (price === undefined || price === null || !Number.isFinite(price)) return false;
  return start !== undefined && Number.isFinite(start);
}

/**
 * Turn a response into a series. Pure, so the parse is exercised through
 * {@link awattarPrices.fetch} against a stubbed transport.
 */
function parseAwattar(zone: string, json: AwattarResponse): SpotPriceSeries {
  const entries = json.data;
  if (!entries?.length) throw new SpotPriceUnpublished("empty market data");

  const startMs: number[] = [];
  const eurPerMwh: number[] = [];
  for (const entry of entries) {
    // An entry without a usable price is dropped, never defaulted — an absent
    // slot means unknown, and 0 EUR/MWh is a meaningful price under §51.
    if (!usable(entry)) continue;
    assertUnit(entry.unit);
    startMs.push(entry.start_timestamp);
    eurPerMwh.push(entry.marketprice);
  }
  if (startMs.length === 0) throw new SpotPriceUnpublished("no usable market data");

  return { zone, startMs, eurPerMwh, resolutionMinutes: resolutionMinutes(entries) };
}

export const awattarPrices: SpotPriceProvider = {
  id: "awattar",
  zones: Object.keys(HOST_BY_ZONE),
  attribution: "Preisdaten: aWATTar",

  async fetch(zone, fromMs, toMs): Promise<SpotPriceSeries> {
    const host = HOST_BY_ZONE[zone];
    if (!host) throw new Error(`awattar does not serve zone "${zone}"`);
    // Epoch milliseconds, `end` exclusive — the window this job asks for maps
    // straight onto it, unlike the date-grained default provider.
    const url = `${host}?start=${fromMs}&end=${toMs}`;
    return parseAwattar(zone, await fetchSpotJson<AwattarResponse>(url, zone));
  },
};
