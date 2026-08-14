/**
 * Day-ahead price provider backed by Fraunhofer ISE's energy-charts API.
 *
 * The default source, chosen for the same reasons Open-Meteo is the default
 * irradiance source: keyless, no registration, self-host friendly, and a
 * documented public JSON endpoint. Critically it serves **true quarter-hour
 * prices** (900-second spacing) for DE-LU, which an hourly source cannot — and a
 * negative quarter-hour hidden inside a net-positive hour is exactly the §51 case
 * this feature exists for.
 *
 * The data is republished from Bundesnetzagentur | SMARD.de under CC BY 4.0, so
 * the credit in `attribution` **must** be rendered wherever the prices appear;
 * it is a licence condition, not a footnote.
 *
 * Two upstream behaviours the caller depends on:
 * - A day that has not cleared yet is an **HTTP error** (404, or 400 further out),
 *   not an empty 200 → {@link SpotPriceUnpublished}.
 * - A *range* whose end is past the last published slot returns **200, truncated**
 *   at that slot. So the job always asks for today+tomorrow and simply gets less
 *   before the auction clears.
 */

import {
  type SpotPriceProvider,
  type SpotPriceSeries,
  SpotPriceUnpublished,
  zoneTimeZone,
} from "../spot-price";
import { fetchSpotJson } from "./shared";

const BASE = "https://api.energy-charts.info/price";

/** Bidding zones the upstream advertises in its OpenAPI document. */
const ZONES = [
  "AT",
  "BE",
  "BG",
  "CH",
  "CZ",
  "DE-LU",
  "DE-AT-LU",
  "DK1",
  "DK2",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IT-Calabria",
  "IT-Centre-North",
  "IT-Centre-South",
  "IT-North",
  "IT-SACOAC",
  "IT-SACODC",
  "IT-Sardinia",
  "IT-Sicily",
  "IT-South",
  "LT",
  "LV",
  "ME",
  "NL",
  "NO1",
  "NO2",
  "NO3",
  "NO4",
  "NO5",
  "PL",
  "PT",
  "RO",
  "RS",
  "SE1",
  "SE2",
  "SE3",
  "SE4",
  "SI",
  "SK",
] as const;

interface EnergyChartsResponse {
  unix_seconds?: number[];
  /** Nullable per entry: the upstream leaves a gap null rather than omitting it. */
  price?: (number | null)[];
  unit?: string;
}

/** `unit` normalised for comparison — the upstream writes it as `"EUR / MWh"`. */
const normalizeUnit = (unit: string): string => unit.replace(/\s+/g, "").toLowerCase();

/** Factor converting a payload's unit to EUR/MWh. */
function unitFactor(unit: string | undefined): number {
  const normalized = normalizeUnit(unit ?? "");
  if (normalized === "eur/mwh") return 1;
  // ct/kWh is 10 EUR/MWh; kept because sibling endpoints publish in it.
  if (normalized === "ct/kwh") return 10;
  if (normalized === "eur/kwh") return 1000;
  throw new Error(`unexpected price unit "${unit}"`);
}

/**
 * Spacing of the series, minutes — read from the data rather than assumed.
 *
 * A payload was observed whose entry count disagreed with the span implied by its
 * first and last timestamps, so nothing here trusts a length: the width comes
 * from the first gap, and a single-entry series falls back to an hour (the
 * coarser, safer reading — it never claims quarter-hour precision it lacks).
 */
function resolutionMinutes(unixSeconds: number[]): number {
  const first = unixSeconds[0];
  const second = unixSeconds[1];
  if (first === undefined || second === undefined) return 60;
  const gapMinutes = Math.round((second - first) / 60);
  return gapMinutes > 0 ? gapMinutes : 60;
}

/** A price the upstream actually gave us — `null` is a published gap, not a zero. */
const isUsablePrice = (price: number | null | undefined): price is number =>
  price !== undefined && price !== null && Number.isFinite(price);

/**
 * The timestamp/price pairs usable on both sides, converted to EUR/MWh.
 *
 * Pair-wise on purpose: a timestamp whose price is missing is **dropped**, never
 * defaulted, because an absent slot means unknown and 0 EUR/MWh means "the
 * market cleared at zero" — two very different things once §51 is reading them.
 */
function usablePairs(
  unixSeconds: number[],
  prices: (number | null)[],
  factor: number,
): Pick<SpotPriceSeries, "startMs" | "eurPerMwh"> {
  const startMs: number[] = [];
  const eurPerMwh: number[] = [];
  for (const [i, seconds] of unixSeconds.entries()) {
    const price = prices[i];
    if (!isUsablePrice(price) || !Number.isFinite(seconds)) continue;
    startMs.push(seconds * 1000);
    eurPerMwh.push(price * factor);
  }
  return { startMs, eurPerMwh };
}

/**
 * Turn a response into a series. Pure, so the whole parse is exercised through
 * {@link energyChartsPrices.fetch} against a stubbed transport.
 */
function parseEnergyCharts(zone: string, json: EnergyChartsResponse): SpotPriceSeries {
  const unixSeconds = json.unix_seconds;
  const prices = json.price;
  if (!unixSeconds?.length || !prices?.length) throw new SpotPriceUnpublished("empty price series");
  const pairs = usablePairs(unixSeconds, prices, unitFactor(json.unit));
  if (pairs.startMs.length === 0) throw new SpotPriceUnpublished("no usable price slots");
  return { zone, ...pairs, resolutionMinutes: resolutionMinutes(unixSeconds) };
}

/** Local `YYYY-MM-DD` for the market's own day — the upstream's `start`/`end` grain. */
const marketDate = (zone: string, atMs: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zoneTimeZone(zone), dateStyle: "short" }).format(
    new Date(atMs),
  );

export const energyChartsPrices: SpotPriceProvider = {
  id: "energy-charts",
  zones: ZONES,
  attribution:
    "Preisdaten: Bundesnetzagentur | SMARD.de (CC BY 4.0), via Fraunhofer ISE energy-charts",

  async fetch(zone, fromMs, toMs): Promise<SpotPriceSeries> {
    // `end` is inclusive of the delivery day, and `toMs` is the exclusive end of
    // the window, so the last requested day is the one a millisecond earlier.
    const url =
      `${BASE}?bzn=${encodeURIComponent(zone)}` +
      `&start=${marketDate(zone, fromMs)}&end=${marketDate(zone, toMs - 1)}`;
    return parseEnergyCharts(zone, await fetchSpotJson<EnergyChartsResponse>(url, zone));
  },
};
