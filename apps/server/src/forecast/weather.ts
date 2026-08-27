/**
 * Open-Meteo weather proxy for the dashboard tile. Open-Meteo is keyless and
 * self-host friendly; the SPA can't call it directly (strict CSP behind ingress),
 * so the server fetches, maps the WMO weather code to a coarse condition/icon,
 * and caches briefly to stay well under Open-Meteo's fair-use limits.
 */

import { type WeatherConfig, weatherReady } from "@SunReye/db/weather";
import { log } from "../shared/logging";

const logger = log("weather");

/** How long a fetched reading is reused before hitting Open-Meteo again. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Coarse condition buckets the web maps to an icon. */
export type WeatherIcon =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

export interface WeatherReading {
  temperature: number;
  unit: string;
  /** WMO weather interpretation code. */
  code: number;
  condition: string;
  icon: WeatherIcon;
  /** Today's shortwave radiation sum (MJ/m²), a light "solar forecast" figure. */
  solarRadiationSum: number | null;
  label: string;
}

/** WMO weather interpretation code → coarse condition + icon, as data. Ranges
 *  are expanded into a lookup once, so interpretation is a single map read. */
const range = (lo: number, hi: number): number[] =>
  Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

const CODE_TABLE: [codes: number[], condition: string, icon: WeatherIcon][] = [
  [[0], "Clear sky", "clear"],
  [[1], "Mainly clear", "clear"],
  [[2], "Partly cloudy", "partly-cloudy"],
  [[3], "Overcast", "cloudy"],
  [[45, 48], "Fog", "fog"],
  [range(51, 57), "Drizzle", "drizzle"],
  [range(61, 67), "Rain", "rain"],
  [range(71, 77), "Snow", "snow"],
  [range(80, 82), "Rain showers", "rain"],
  [[85, 86], "Snow showers", "snow"],
  [range(95, 99), "Thunderstorm", "thunder"],
];

const CODE_MAP = new Map<number, { condition: string; icon: WeatherIcon }>(
  CODE_TABLE.flatMap(([codes, condition, icon]) =>
    codes.map((c) => [c, { condition, icon }] as const),
  ),
);

function interpret(code: number): { condition: string; icon: WeatherIcon } {
  return CODE_MAP.get(code) ?? { condition: "Unknown", icon: "cloudy" };
}

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number };
  current_units?: { temperature_2m?: string };
  daily?: { shortwave_radiation_sum?: (number | null)[] };
}

/** The `current` block with the two fields a reading can't do without. */
type CurrentBlock = { temperature_2m: number; weather_code: number };

/** Narrow the response's `current` block, or throw when it can't be read. */
function requireCurrent(data: OpenMeteoResponse): CurrentBlock {
  const c = data.current;
  if (!c || c.temperature_2m === undefined || c.weather_code === undefined) {
    throw new Error("missing current fields");
  }
  return { temperature_2m: c.temperature_2m, weather_code: c.weather_code };
}

/** Today's radiation sum (the first daily entry), or null when absent/null. */
function radiationSum(daily: (number | null)[] | undefined): number | null {
  if (!daily || daily.length === 0) return null;
  return daily[0] ?? null;
}

/** Parse an Open-Meteo response into a reading, or throw on missing fields. */
function toReading(data: OpenMeteoResponse, config: WeatherConfig): WeatherReading {
  const current = requireCurrent(data);
  const { condition, icon } = interpret(current.weather_code);
  return {
    temperature: current.temperature_2m,
    unit: data.current_units?.temperature_2m ?? "°C",
    code: current.weather_code,
    condition,
    icon,
    solarRadiationSum: radiationSum(data.daily?.shortwave_radiation_sum),
    label: config.label,
  };
}

let cache: { key: string; at: number; reading: WeatherReading } | null = null;
const fresh = (key: string): boolean =>
  cache !== null && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS;

/** The keyless current-weather query for one location. */
const weatherUrl = (config: WeatherConfig): string =>
  "https://api.open-meteo.com/v1/forecast" +
  `?latitude=${config.latitude}&longitude=${config.longitude}` +
  "&current=temperature_2m,weather_code&daily=shortwave_radiation_sum" +
  "&timezone=auto&forecast_days=1";

/** Fetch + parse one reading, throwing on a non-2xx or unreadable response. */
async function requestReading(config: WeatherConfig): Promise<WeatherReading> {
  const res = await fetch(weatherUrl(config), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return toReading((await res.json()) as OpenMeteoResponse, config);
}

/** Log a failed fetch and serve a stale reading for the same location, if any. */
function staleAfterFailure(key: string, err: unknown): WeatherReading | null {
  logger.warn("fetch failed: {error}", { error: err instanceof Error ? err.message : err });
  return cache?.key === key ? cache.reading : null;
}

/**
 * Current weather for the configured location, or `null` when weather is
 * disabled/unconfigured or the upstream call fails with no cached value. A stale
 * cached reading is preferred over `null` on a transient fetch failure.
 */
export async function fetchWeather(config: WeatherConfig): Promise<WeatherReading | null> {
  if (!weatherReady(config)) return null;

  const key = `${config.latitude},${config.longitude}`;
  if (fresh(key)) return cache!.reading;

  try {
    const reading = await requestReading(config);
    cache = { key, at: Date.now(), reading };
    return reading;
  } catch (err) {
    return staleAfterFailure(key, err);
  }
}
