/**
 * PV production forecast for the dashboard's weather tile.
 *
 * Split so new data sources stay cheap to add: a {@link SolarIrradianceProvider}
 * only delivers hourly plane-of-array irradiance + ambient temperature for the
 * plant's location; the PV power model here (orientation-aware arrays, cell
 * temperature derating, static system losses) is provider-agnostic and turns
 * any provider's series into expected AC watts and daily kWh sums. Open-Meteo
 * is the default provider; register additions in {@link PROVIDERS}.
 */

import { type WeatherConfig, forecastReady } from "@SunReye/db/weather";
import { log } from "./logging";
import { openMeteoIrradiance } from "./solar-providers/open-meteo";

const logger = log("solar-forecast");

/** One panel orientation a provider must resolve irradiance for. */
export interface PlaneOfArray {
  /** Panel tilt from horizontal, degrees. */
  tilt: number;
  /** Panel azimuth, degrees (0 = south, -90 = east, 90 = west). */
  azimuth: number;
}

/** What a provider delivers: aligned hourly series for the requested planes. */
export interface IrradianceForecast {
  /** Hour-start timestamps in the plant's local time (`YYYY-MM-DDTHH:mm`). */
  times: string[];
  /** Offset of those local times from UTC, in seconds. */
  utcOffsetSeconds: number;
  /** Ambient 2 m temperature per hour, °C. */
  temperature: number[];
  /** Global tilted irradiance per requested plane, W/m² per hour. */
  gti: number[][];
}

export interface SolarIrradianceProvider {
  readonly id: string;
  fetch(
    location: { latitude: number; longitude: number },
    planes: PlaneOfArray[],
  ): Promise<IrradianceForecast>;
}

/** Registered providers; the config's `forecast.provider` picks one. */
const PROVIDERS: Record<string, SolarIrradianceProvider> = {
  [openMeteoIrradiance.id]: openMeteoIrradiance,
};

export interface SolarForecastHour {
  /** Hour start, plant-local time. */
  time: string;
  /** Expected plant AC output over that hour, W. */
  watts: number;
}

/** Near-term projection over the 15 minutes following `now`. */
export interface SolarForecastNext15 {
  /** Peak expected AC output during the window, W. */
  maxPowerW: number;
  /** Expected energy produced during the window, kWh. */
  energyKwh: number;
}

export interface SolarForecast {
  provider: string;
  hourly: SolarForecastHour[];
  /** Expected production for the local calendar day, kWh. */
  todayKwh: number;
  /** Expected production from now to local midnight, kWh (running hour prorated). */
  remainingTodayKwh: number;
  tomorrowKwh: number;
  /** Peak power and energy expected over the next 15 minutes. */
  next15: SolarForecastNext15;
}

/**
 * Live/inferred inputs the clipping model needs but the config can't carry.
 * Injected by the orchestrator (and by tests) so {@link buildSolarForecast}
 * stays pure.
 */
export interface ForecastSimInputs {
  /** Battery state of charge at `nowMs`, %; `null` when unavailable. */
  startSocPct: number | null;
  /** Average house load, W, fed to the clipping model; `null` → treated as 0. */
  houseLoadW: number | null;
}

/** Resolved per-hour clipping limits (null config → non-binding sentinels). */
interface ClipCaps {
  /** Max grid feed-in, W; `Infinity` when unconfigured (no export cap). */
  maxOutputW: number;
  /** Usable battery energy, kWh; `0` when the plant has no modelled battery. */
  batteryCapKwh: number;
  /** Max battery charge power, W; `Infinity` when unbounded. */
  batteryMaxChargeW: number;
  /** Reserve floor the battery isn't discharged below, kWh. */
  batteryMinKwh: number;
}

function clipCaps(config: WeatherConfig["forecast"]): ClipCaps {
  const cap = config.battery?.usableKwh ?? 0;
  return {
    maxOutputW: config.maxOutputW ?? Number.POSITIVE_INFINITY,
    batteryCapKwh: cap,
    batteryMaxChargeW: config.battery?.maxChargeW ?? Number.POSITIVE_INFINITY,
    batteryMinKwh: cap * ((config.battery?.minSoc ?? 0) / 100),
  };
}

// Cell-temperature model (NOCT): cells run ~25 °C above ambient at 800 W/m²,
// scaling linearly with irradiance.
const CELL_TEMP_RISE_PER_WM2 = 25 / 800;
const STC_CELL_TEMP_C = 25;

/**
 * Expected AC power of one array at a given plane-of-array irradiance.
 * DC = kWp scaled by irradiance relative to STC (1000 W/m²), derated by the
 * datasheet temperature coefficient at the estimated cell temperature; AC
 * applies the static system-loss percentage.
 */
export function pvPowerW(
  gtiWm2: number,
  ambientC: number,
  kwp: number,
  tempCoefficientPctPerC: number,
  systemLossPct: number,
): number {
  if (gtiWm2 <= 0) return 0;
  const cellC = ambientC + gtiWm2 * CELL_TEMP_RISE_PER_WM2;
  const derate = 1 + (tempCoefficientPctPerC / 100) * (cellC - STC_CELL_TEMP_C);
  const dcW = kwp * gtiWm2 * Math.max(0, derate); // kwp * 1000 * (gti / 1000)
  return Math.max(0, dcW * (1 - systemLossPct / 100));
}

/**
 * One hour of the plant's energy flow, in the self-consumption priority order:
 * PV serves the house load, then charges the battery (bounded by charge rate
 * and remaining headroom), then exports up to the feed-in cap — and whatever
 * is left has nowhere to go and is **curtailed**. On a PV deficit the battery
 * discharges to cover the shortfall (down to its reserve), which reclaims
 * headroom for later hours and, crucially, overnight for the next day.
 *
 * Returns the *usable* AC output (raw PV minus curtailment) and the battery's
 * new energy content, so the caller can carry state to the next hour.
 */
function simulateHour(
  pvW: number,
  loadW: number,
  socKwh: number,
  caps: ClipCaps,
): { usefulW: number; socKwh: number } {
  const pv = Math.max(0, pvW); // Wh over this 1-hour step
  const load = Math.max(0, loadW);
  const pvToLoad = Math.min(pv, load);
  let surplus = pv - pvToLoad;
  const deficit = load - pvToLoad;
  let soc = socKwh;
  let curtailed = 0;

  if (surplus > 0) {
    const headroomWh = Math.max(0, caps.batteryCapKwh - soc) * 1000;
    const charged = Math.min(surplus, caps.batteryMaxChargeW, headroomWh);
    soc += charged / 1000;
    surplus -= charged;
    const exported = Math.min(surplus, caps.maxOutputW);
    curtailed = surplus - exported;
  } else if (deficit > 0) {
    const availableWh = Math.max(0, soc - caps.batteryMinKwh) * 1000;
    soc -= Math.min(deficit, availableWh) / 1000;
  }

  return { usefulW: pv - curtailed, socKwh: soc };
}

/**
 * Peak power and energy over the 15 minutes after `now`, from the (already
 * clipped) hourly curve. Each hour's watts is its average power, so the window
 * spans at most two hour buckets; energy is the time-weighted sum and the peak
 * is the larger of the touched hours.
 */
function computeNext15(
  hourly: SolarForecastHour[],
  nowMs: number,
  utcOffsetSeconds: number,
): SolarForecastNext15 {
  const byHour = new Map(hourly.map((h) => [h.time.slice(0, 13), h.watts]));
  const start = new Date(nowMs + utcOffsetSeconds * 1000);
  const end = new Date(nowMs + utcOffsetSeconds * 1000 + 15 * 60 * 1000);
  const wStart = byHour.get(start.toISOString().slice(0, 13)) ?? 0;
  const minInto = start.getUTCMinutes() + start.getUTCSeconds() / 60;
  const minsInFirst = Math.min(15, 60 - minInto);
  const wEnd = byHour.get(end.toISOString().slice(0, 13)) ?? 0;
  const minsInSecond = 15 - minsInFirst;
  const energyKwh = (wStart * minsInFirst + wEnd * minsInSecond) / 60 / 1000;
  const maxPowerW = Math.max(wStart, minsInSecond > 0 ? wEnd : 0);
  return { maxPowerW, energyKwh };
}

/**
 * Combine a provider's irradiance series with the plant config into hourly AC
 * watts and daily kWh sums. Pure — `nowMs`/`sim` are injectable for tests.
 *
 * When a feed-in cap and/or battery is configured, hours from the current one
 * forward are run through {@link simulateHour} so `watts` reflects *usable*
 * output after clipping (battery seeded from live SOC, then carried across the
 * day boundary). Past hours keep the raw PV estimate — there is no SOC history
 * to reconstruct them, and they are already measured elsewhere anyway.
 */
export function buildSolarForecast(
  config: WeatherConfig["forecast"],
  data: IrradianceForecast,
  provider: string,
  nowMs = Date.now(),
  sim?: ForecastSimInputs,
): SolarForecast {
  const rawWatts = data.times.map((_time, i) => {
    let watts = 0;
    config.arrays.forEach((arr, a) => {
      watts += pvPowerW(
        data.gti[a]?.[i] ?? 0,
        data.temperature[i] ?? STC_CELL_TEMP_C,
        arr.kwp,
        config.tempCoefficient,
        config.systemLoss,
      );
    });
    return watts;
  });

  // Bucket by the plant's local calendar day. "Remaining" includes the running
  // hour prorated by the fraction of it still ahead, so an 11:30 view counts
  // half of the 11:00 slot instead of the whole hour.
  const shifted = new Date(nowMs + data.utcOffsetSeconds * 1000);
  const localNow = shifted.toISOString();
  const today = localNow.slice(0, 10);
  const nowHour = localNow.slice(0, 13);
  const hourLeft = 1 - (shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds()) / 3600;
  const tomorrow = new Date(nowMs + data.utcOffsetSeconds * 1000 + 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  // Run the clipping model only when something can actually clip; otherwise the
  // forecast is the raw PV estimate, identical to before this feature.
  const caps = clipCaps(config);
  const clippingOn = caps.maxOutputW < Number.POSITIVE_INFINITY || caps.batteryCapKwh > 0;
  const loadW = sim?.houseLoadW ?? 0;
  // Unknown SOC → assume the battery sits at its reserve (full headroom), so we
  // never invent curtailment we can't justify.
  const startPct = sim?.startSocPct ?? config.battery?.minSoc ?? 0;
  let socKwh = caps.batteryCapKwh * (startPct / 100);

  const hourly: SolarForecastHour[] = data.times.map((time, i) => {
    const raw = rawWatts[i] ?? 0;
    if (!clippingOn || time.slice(0, 13) < nowHour) return { time, watts: raw };
    const step = simulateHour(raw, loadW, socKwh, caps);
    socKwh = step.socKwh;
    return { time, watts: step.usefulW };
  });

  const kwh = (hours: SolarForecastHour[]) => hours.reduce((s, h) => s + h.watts / 1000, 0);

  return {
    provider,
    hourly,
    todayKwh: kwh(hourly.filter((h) => h.time.startsWith(today))),
    remainingTodayKwh: hourly.reduce((s, h) => {
      if (!h.time.startsWith(today)) return s;
      const hour = h.time.slice(0, 13);
      if (hour < nowHour) return s;
      return s + (h.watts / 1000) * (hour === nowHour ? hourLeft : 1);
    }, 0),
    tomorrowKwh: kwh(hourly.filter((h) => h.time.startsWith(tomorrow))),
    next15: computeNext15(hourly, nowMs, data.utcOffsetSeconds),
  };
}

/** Whether any clipping limit is configured — gates the live/DB sim reads. */
function clippingConfigured(f: WeatherConfig["forecast"]): boolean {
  return f.maxOutputW != null || f.battery != null;
}

// House load changes slowly, so the (relatively pricey) median query is cached
// well past the irradiance TTL; SOC, by contrast, is read live on every call.
const LOAD_MEDIAN_TTL_MS = 6 * 3600 * 1000;
const LOAD_MEDIAN_DAYS = 14;
let loadCache: { at: number; watts: number | null } | null = null;

/**
 * Live SOC + house load for the clipping model (a config load override wins).
 * The `./inverter`, `./state` and `./history` deps are imported lazily so this
 * file's pure model stays importable without the server env / DB — mirroring
 * the DB-free split used by {@link ./energy-calc}.
 */
async function resolveSimInputs(config: WeatherConfig): Promise<ForecastSimInputs> {
  const [{ getActiveProfileOrNull }, { liveState }] = await Promise.all([
    import("./inverter"),
    import("./state"),
  ]);
  const profile = getActiveProfileOrNull();
  const keyFor = (role: "battery.soc" | "load.power") =>
    profile?.metrics.find((m) => m.role === role)?.key;

  const socKey = keyFor("battery.soc");
  const soc = socKey ? liveState.latest?.metrics[socKey] : undefined;
  const startSocPct = typeof soc === "number" && Number.isFinite(soc) ? soc : null;

  let houseLoadW = config.forecast.houseLoadW;
  if (houseLoadW == null && profile) {
    if (loadCache && Date.now() - loadCache.at < LOAD_MEDIAN_TTL_MS) {
      houseLoadW = loadCache.watts;
    } else {
      const loadKey = keyFor("load.power");
      const inverterId = liveState.latest?.inverterId ?? profile.id;
      const { queryMedianHourlyAvg } = await import("./history");
      const watts = loadKey
        ? await queryMedianHourlyAvg(loadKey, inverterId, LOAD_MEDIAN_DAYS)
        : null;
      loadCache = { at: Date.now(), watts };
      houseLoadW = watts;
    }
  }

  return { startSocPct, houseLoadW: houseLoadW ?? null };
}

/** How long fetched irradiance is reused before hitting the provider again. */
const CACHE_TTL_MS = 30 * 60 * 1000;

// The cache holds the provider's raw irradiance, not the finished forecast:
// today/remaining sums depend on "now", so they are rebuilt on every request
// (cheap — 48 hours × arrays) instead of being frozen for the TTL.
let cache: { key: string; at: number; data: IrradianceForecast; provider: string } | null = null;

/**
 * Production forecast for the configured plant, or `null` when the forecast is
 * disabled/unconfigured, the provider is unknown, or the fetch fails with no
 * cached value. A stale cached forecast is preferred over `null` on transient
 * failures, mirroring the weather proxy.
 */
export async function fetchSolarForecast(config: WeatherConfig): Promise<SolarForecast | null> {
  if (!forecastReady(config)) return null;

  const provider = PROVIDERS[config.forecast.provider];
  if (!provider) {
    logger.warn("unknown provider: {provider}", { provider: config.forecast.provider });
    return null;
  }

  // Live SOC + house load for the clipping model, resolved fresh each call (SOC
  // moves constantly); skipped entirely when no clipping limit is configured.
  const sim = clippingConfigured(config.forecast) ? await resolveSimInputs(config) : undefined;

  const key = JSON.stringify([config.latitude, config.longitude, config.forecast]);
  if (cache !== null && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return buildSolarForecast(config.forecast, cache.data, cache.provider, Date.now(), sim);
  }

  try {
    const data = await provider.fetch(
      { latitude: config.latitude, longitude: config.longitude },
      config.forecast.arrays.map(({ tilt, azimuth }) => ({ tilt, azimuth })),
    );
    cache = { key, at: Date.now(), data, provider: provider.id };
    return buildSolarForecast(config.forecast, data, provider.id, Date.now(), sim);
  } catch (err) {
    logger.warn("fetch failed: {error}", { error: err instanceof Error ? err.message : err });
    return cache?.key === key
      ? buildSolarForecast(config.forecast, cache.data, cache.provider, Date.now(), sim)
      : null;
  }
}
