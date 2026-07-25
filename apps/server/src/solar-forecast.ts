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
import { type CorrectionModel, correctionFactor, hourOf, monthOf } from "./forecast-correction";
import { log } from "./logging";
import { cosAoi, sunPosition } from "./solar-geometry";
import { openMeteoIrradiance } from "./solar-providers/open-meteo";

const logger = log("solar-forecast");

/** One panel orientation a provider must resolve irradiance for. */
export interface PlaneOfArray {
  /** Panel tilt from horizontal, degrees. */
  tilt: number;
  /** Panel azimuth, degrees (0 = south, -90 = east, 90 = west). */
  azimuth: number;
}

/** What a provider delivers: aligned time series for the requested planes. */
export interface IrradianceForecast {
  /**
   * Sample timestamps in the plant's local time (`YYYY-MM-DDTHH:mm`), on a
   * regular grid of at most one hour (15-minute steps for Open-Meteo).
   */
  times: string[];
  /** Offset of those local times from UTC, in seconds. */
  utcOffsetSeconds: number;
  /** Location the series was resolved for — drives the sun-position geometry. */
  location: { latitude: number; longitude: number };
  /** Ambient 2 m temperature at each timestamp, °C. */
  temperature: number[];
  /**
   * *Instantaneous* global tilted irradiance at each timestamp, W/m², per
   * requested plane. buildSolarForecast integrates consecutive samples into
   * per-step average power, so the value is a point sample, not a step mean.
   */
  gti: number[][];
  /**
   * Instantaneous direct-normal irradiance, W/m². Optional: when present it
   * enables the beam/diffuse split behind the incidence-angle (IAM) loss;
   * providers that can't deliver it fall back to the flat system loss alone.
   */
  dni?: number[];
  /**
   * 10 m wind speed, m/s. Optional: enables the Faiman cell-temperature model
   * (wind cools cells); absent, cells follow the static NOCT rise.
   */
  windSpeed?: number[];
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

export interface SolarForecastPoint {
  /** Slot start, plant-local time. */
  time: string;
  /** Expected average plant AC output over the slot, W. */
  watts: number;
  /** Estimated peak AC output within the slot, W (≥ `watts`). */
  peakWatts: number;
}

/** Near-term projection over the 15 minutes following `now`. */
export interface SolarForecastNext15 {
  /** Peak expected AC output during the window, W. */
  maxPowerW: number;
  /** Expected energy produced during the window, kWh. */
  energyKwh: number;
}

/**
 * One power projection over the series: the per-slot curve plus its daily/near-term
 * sums. The forecast carries two of these — see {@link SolarForecast}.
 */
export interface ForecastView {
  series: SolarForecastPoint[];
  /** Expected production for the local calendar day, kWh. */
  todayKwh: number;
  /** Expected production from now to local midnight, kWh (running hour prorated). */
  remainingTodayKwh: number;
  tomorrowKwh: number;
  /** Peak power and energy expected over the next 15 minutes. */
  next15: SolarForecastNext15;
}

export interface SolarForecast extends ForecastView {
  provider: string;
  /** Slot width of `series` in minutes (15 for Open-Meteo). */
  stepMinutes: number;
  /** Offset of the `series` local times from UTC, seconds — for offset-aware export. */
  utcOffsetSeconds: number;
  /**
   * The top-level view is the **usable** output: raw PV after the feed-in cap and
   * battery model curtail it (what the plant can actually use/export). `raw` is the
   * **uncurtailed** PV potential — equal to the usable view when nothing clips. The
   * dashboard tile shows the usable view; external consumers usually want `raw` so
   * they can see production *above* the feed-in limit and act on it.
   */
  raw: ForecastView;
}

/**
 * A single {@link ForecastView} shaped for external consumers (MQTT + the
 * `/api/forecast*` endpoints): view fields + forecast metadata + a `detailedForecast`
 * curve shaped like Solcast / Forecast.Solar so Home Assistant PV blueprints consume
 * it unmodified. Built per variant (raw vs usable) by {@link toForecastExport}.
 */
export interface SolarForecastExport extends ForecastView {
  provider: string;
  stepMinutes: number;
  utcOffsetSeconds: number;
  /** Solcast-compatible detailed curve: one offset-aware timestamp + AC watts per slot. */
  detailedForecast: { period_start: string; watts: number }[];
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
  /**
   * Measured battery SOC at the series' first slot (plant-local midnight), %;
   * `null`/absent when no rollup covers that hour. Unlocks clipping of *past*
   * slots: the sim runs from the day's start instead of only from `nowMs`, so
   * the usable view has no raw→clipped seam at the current slot.
   */
  dayStartSocPct?: number | null;
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

// Cell-temperature models. Fallback (NOCT): cells run ~25 °C above ambient at
// 800 W/m², scaling linearly with irradiance. With wind data, Faiman
// (IEC 61853-2 open-rack coefficients, W/m²K): the same sun heats cells less
// when wind carries the heat away — at ~1 m/s both models agree.
const CELL_TEMP_RISE_PER_WM2 = 25 / 800;
const STC_CELL_TEMP_C = 25;
const FAIMAN_U0 = 25;
const FAIMAN_U1 = 6.84;

// Incidence-angle modifier (Martin & Ruiz 2001): panel glass reflects a
// growing share of the *beam* as the sun hits it at ever more glancing angles
// — the physical loss behind low-sun (morning/evening) over-forecasts that a
// flat system-loss percentage cannot capture. Diffuse light arrives from the
// whole sky dome, so its integrated modifier is roughly constant.
const MARTIN_RUIZ_AR = 0.16;
const IAM_DIFFUSE = 0.95;

function iamMartinRuiz(cosTheta: number): number {
  if (cosTheta <= 0) return 0;
  return (1 - Math.exp(-cosTheta / MARTIN_RUIZ_AR)) / (1 - Math.exp(-1 / MARTIN_RUIZ_AR));
}

/** One timestamp's environment for a single array. Optional fields unlock the
 * finer physics; without them the model degrades to its simpler forms. */
export interface PvSample {
  /** Plane-of-array (tilted) irradiance, W/m². */
  gtiWm2: number;
  /** Ambient 2 m temperature, °C. */
  ambientC: number;
  /** Direct-normal irradiance, W/m² — with `cosAoi`, enables the IAM split. */
  dniWm2?: number;
  /** Cosine of the sun→panel angle of incidence (≤ 0 = sun behind the plane). */
  cosAoi?: number;
  /** 10 m wind speed, m/s — enables Faiman convective cooling. */
  windMs?: number;
}

/**
 * The irradiance that reaches the cells after reflection: the beam share
 * (DNI projected onto the plane, capped by the GTI itself) is derated by the
 * Martin–Ruiz IAM at the current incidence angle, the diffuse remainder by a
 * constant sky-dome factor. Without a beam/diffuse split, applying a beam IAM
 * to the total would over-penalise cloudy hours — so it falls back to raw GTI.
 */
function effectiveIrradianceWm2(sample: PvSample): number {
  if (sample.dniWm2 === undefined || sample.cosAoi === undefined) return sample.gtiWm2;
  const beam = Math.min(sample.gtiWm2, sample.dniWm2 * Math.max(0, sample.cosAoi));
  const diffuse = sample.gtiWm2 - beam;
  return beam * iamMartinRuiz(sample.cosAoi) + diffuse * IAM_DIFFUSE;
}

/** Cell temperature heats with the *full* incident irradiance (reflected or
 * not, the plane sits in the same sun), cooled by wind when known. */
function cellTempC(sample: PvSample): number {
  if (sample.windMs === undefined) return sample.ambientC + sample.gtiWm2 * CELL_TEMP_RISE_PER_WM2;
  return sample.ambientC + sample.gtiWm2 / (FAIMAN_U0 + FAIMAN_U1 * sample.windMs);
}

/**
 * Expected AC power of one array for a sample. DC = kWp scaled by the
 * IAM-effective irradiance relative to STC (1000 W/m²), derated by the
 * datasheet temperature coefficient at the estimated cell temperature; AC
 * applies the static system-loss percentage.
 */
export function pvPowerW(
  sample: PvSample,
  kwp: number,
  tempCoefficientPctPerC: number,
  systemLossPct: number,
): number {
  const effectiveWm2 = effectiveIrradianceWm2(sample);
  if (effectiveWm2 <= 0) return 0;
  const derate = 1 + (tempCoefficientPctPerC / 100) * (cellTempC(sample) - STC_CELL_TEMP_C);
  const dcW = kwp * effectiveWm2 * Math.max(0, derate); // kwp * 1000 * (eff / 1000)
  return Math.max(0, dcW * (1 - systemLossPct / 100));
}

/**
 * One slot of the plant's energy flow, in the self-consumption priority order:
 * PV serves the house load, then charges the battery (bounded by charge rate
 * and remaining headroom), then exports up to the feed-in cap — and whatever
 * is left has nowhere to go and is **curtailed**. On a PV deficit the battery
 * discharges to cover the shortfall (down to its reserve), which reclaims
 * headroom for later slots and, crucially, overnight for the next day.
 *
 * `dtH` is the slot width in hours; power bounds (charge rate, feed-in cap)
 * apply as-is while battery energy moves by power × dtH.
 *
 * Returns the *usable* AC output (raw PV minus curtailment) and the battery's
 * new energy content, so the caller can carry state to the next slot.
 */
function simulateStep(
  pvW: number,
  loadW: number,
  socKwh: number,
  caps: ClipCaps,
  dtH: number,
): { usefulW: number; socKwh: number } {
  const pv = Math.max(0, pvW);
  const load = Math.max(0, loadW);
  const pvToLoad = Math.min(pv, load);
  let surplus = pv - pvToLoad;
  const deficit = load - pvToLoad;
  let soc = socKwh;
  let curtailed = 0;

  if (surplus > 0) {
    // Headroom expressed as the power that would fill it within this slot.
    const headroomW = (Math.max(0, caps.batteryCapKwh - soc) * 1000) / dtH;
    const charged = Math.min(surplus, caps.batteryMaxChargeW, headroomW);
    soc += (charged * dtH) / 1000;
    surplus -= charged;
    const exported = Math.min(surplus, caps.maxOutputW);
    curtailed = surplus - exported;
  } else if (deficit > 0) {
    const availableW = (Math.max(0, soc - caps.batteryMinKwh) * 1000) / dtH;
    soc -= (Math.min(deficit, availableW) * dtH) / 1000;
  }

  return { usefulW: pv - curtailed, socKwh: soc };
}

/**
 * Peak power and energy over the 15 minutes after `now`, from the (already
 * clipped) series. Energy is the time-weighted sum of the slots the window
 * overlaps; the peak is the largest per-slot peak among them.
 */
function computeNext15(
  series: SolarForecastPoint[],
  startMs: number[],
  widthMs: number[],
  nowMs: number,
): SolarForecastNext15 {
  const endMs = nowMs + 15 * 60 * 1000;
  let energyKwh = 0;
  let maxPowerW = 0;
  series.forEach((p, i) => {
    const s = startMs[i] ?? 0;
    const overlapMs = Math.min(s + (widthMs[i] ?? 0), endMs) - Math.max(s, nowMs);
    if (overlapMs <= 0) return;
    energyKwh += (p.watts * overlapMs) / 3_600_000 / 1000;
    maxPowerW = Math.max(maxPowerW, p.peakWatts);
  });
  return { maxPowerW, energyKwh };
}

/**
 * Combine a provider's irradiance series with the plant config into per-slot
 * AC watts and daily kWh sums. Pure — `nowMs`/`sim` are injectable for tests.
 * The slot width follows the provider's sample grid (15 min for Open-Meteo,
 * capped at one hour); sparse/gappy series degrade to hour-wide point samples.
 *
 * When a feed-in cap and/or battery is configured, slots are run through
 * {@link simulateStep} so `watts` reflects *usable* output after clipping.
 * Past slots are simulated too when the battery state at the series start is
 * known (`sim.dayStartSocPct`) or irrelevant (no battery); at the current slot
 * the simulated SOC yields to the measured live one, which is truth for
 * everything still ahead. Without a day-start SOC, past slots keep the raw PV
 * estimate — clipping them would rest on state we can't justify.
 *
 * A learned {@link CorrectionModel} (optional) scales each sample by its
 * `(month, hour)` factor *before* slot integration and clipping, so the site
 * bias fix flows into both views and curtailment is computed on corrected PV.
 */
export function buildSolarForecast(
  config: WeatherConfig["forecast"],
  data: IrradianceForecast,
  provider: string,
  nowMs = Date.now(),
  sim?: ForecastSimInputs,
  correction?: CorrectionModel,
): SolarForecast {
  // Instantaneous AC power at each timestamp: sun position feeds the per-array
  // incidence angle so the IAM split (when DNI is available) can bite. A learned
  // correction (when supplied) then scales the sample by its (month, hour) factor.
  const instW = data.times.map((time, i) => {
    const atMs = Date.parse(`${time}:00Z`) - data.utcOffsetSeconds * 1000;
    const sun = sunPosition(data.location.latitude, data.location.longitude, atMs);
    const env = {
      ambientC: data.temperature[i] ?? STC_CELL_TEMP_C,
      dniWm2: data.dni?.[i],
      windMs: data.windSpeed?.[i],
    };
    let watts = 0;
    config.arrays.forEach((arr, a) => {
      watts += pvPowerW(
        { ...env, gtiWm2: data.gti[a]?.[i] ?? 0, cosAoi: cosAoi(sun, arr.tilt, arr.azimuth) },
        arr.kwp,
        config.tempCoefficient,
        config.systemLoss,
      );
    });
    return correction ? watts * correctionFactor(correction, monthOf(time), hourOf(time)) : watts;
  });

  // Slot geometry. Each sample opens the slot [tᵢ, tᵢ₊₁); its width is the gap
  // to the next sample, capped at one hour so sparse/gappy series (a DST seam,
  // a provider hiccup) degrade to hour-wide point samples instead of smearing
  // one sample across the gap. The last sample inherits the preceding width.
  const HOUR_MS = 3_600_000;
  const startMs = data.times.map((t) => Date.parse(`${t}:00Z`) - data.utcOffsetSeconds * 1000);
  const widthMs = startMs.map((s, i) => {
    const next = startMs[i + 1];
    if (next !== undefined) return Math.min(Math.max(1, next - s), HOUR_MS);
    return i > 0
      ? Math.min(Math.max(1, (startMs[i] ?? 0) - (startMs[i - 1] ?? 0)), HOUR_MS)
      : HOUR_MS;
  });

  // Average power over each slot [tᵢ, tᵢ₊₁), via the trapezoid of its
  // endpoints. This is what makes a forecast bar line up with the energy
  // actually accumulated during that same slot: sampling a single endpoint
  // instead biases the steep limbs — over-reporting the sunset ramp and
  // under-reporting the sunrise ramp. Only integrate genuinely adjacent
  // samples (gap within the hour cap); anything else falls back to the point
  // sample. The per-slot peak is the larger endpoint — what the UI reports as
  // "max power" for the slot.
  const adjacent = (i: number) => {
    const next = startMs[i + 1];
    return next !== undefined && next - (startMs[i] ?? 0) <= HOUR_MS;
  };
  const rawWatts = instW.map((w, i) => (adjacent(i) ? (w + (instW[i + 1] ?? w)) / 2 : w));
  const rawPeakW = instW.map((w, i) => (adjacent(i) ? Math.max(w, instW[i + 1] ?? w) : w));

  // Bucket by the plant's local calendar day. "Remaining" includes the running
  // slot prorated by the fraction of it still ahead, so an 11:30 view with
  // hourly slots counts half of the 11:00 slot instead of the whole hour.
  const localNow = new Date(nowMs + data.utcOffsetSeconds * 1000).toISOString();
  const today = localNow.slice(0, 10);
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
  // Past slots are simulated only when the battery state at the series start is
  // known (measured day-start SOC) or irrelevant (no battery — the cap alone
  // clips); otherwise they keep the raw estimate.
  const simPast = clippingOn && (caps.batteryCapKwh === 0 || sim?.dayStartSocPct != null);
  let socKwh =
    caps.batteryCapKwh * ((simPast ? (sim?.dayStartSocPct ?? startPct) : startPct) / 100);

  // The raw (uncurtailed) PV potential, straight from the power model.
  const rawSeries: SolarForecastPoint[] = data.times.map((time, i) => ({
    time,
    watts: rawWatts[i] ?? 0,
    peakWatts: rawPeakW[i] ?? 0,
  }));

  // The usable view: raw PV with the feed-in cap + battery model curtailing the
  // surplus. Identical to raw when nothing clips; past slots keep the raw
  // estimate unless the day-start SOC lets the sim reconstruct them.
  let reseeded = false;
  const usableSeries: SolarForecastPoint[] = rawSeries.map((point, i) => {
    const width = widthMs[i] ?? HOUR_MS;
    const isPast = (startMs[i] ?? 0) + width <= nowMs;
    if (!clippingOn || (isPast && !simPast)) return point;
    // At the past→future seam the simulated SOC yields to the measured one:
    // forecast weather drifts from what actually fell, and the live reading is
    // truth for everything still ahead.
    if (simPast && !isPast && !reseeded) {
      reseeded = true;
      if (sim?.startSocPct != null) socKwh = caps.batteryCapKwh * (sim.startSocPct / 100);
    }
    const step = simulateStep(point.watts, loadW, socKwh, caps, width / HOUR_MS);
    socKwh = step.socKwh;
    // Clipping caps the instantaneous output too: scale the peak by the slot's
    // usable share so it never reports curtailed power.
    const peakWatts =
      point.watts > 0 ? point.peakWatts * (step.usefulW / point.watts) : step.usefulW;
    return { time: point.time, watts: step.usefulW, peakWatts };
  });

  // Daily/near-term sums for one series, bucketed by the plant's local day.
  // "Remaining" includes the running slot prorated by the fraction still ahead.
  const viewOf = (series: SolarForecastPoint[]): ForecastView => {
    const slotKwh = (i: number) => ((series[i]?.watts ?? 0) * (widthMs[i] ?? 0)) / HOUR_MS / 1000;
    const dayKwh = (day: string) =>
      series.reduce((s, p, i) => (p.time.startsWith(day) ? s + slotKwh(i) : s), 0);
    return {
      series,
      todayKwh: dayKwh(today),
      remainingTodayKwh: series.reduce((s, p, i) => {
        if (!p.time.startsWith(today)) return s;
        const width = widthMs[i] ?? 0;
        const left = Math.min((startMs[i] ?? 0) + width - nowMs, width);
        return left <= 0 ? s : s + slotKwh(i) * (left / width);
      }, 0),
      tomorrowKwh: dayKwh(tomorrow),
      next15: computeNext15(series, startMs, widthMs, nowMs),
    };
  };

  return {
    provider,
    stepMinutes: Math.round(Math.min(...widthMs, HOUR_MS) / 60_000),
    utcOffsetSeconds: data.utcOffsetSeconds,
    ...viewOf(usableSeries),
    raw: viewOf(rawSeries),
  };
}

/** Format a UTC offset in seconds as an ISO-8601 designator (`+02:00`, `Z`). */
function isoOffset(seconds: number): string {
  if (seconds === 0) return "Z";
  const sign = seconds < 0 ? "-" : "+";
  const abs = Math.abs(seconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, "0");
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/** Which power view to export: `"raw"` PV potential or `"usable"` post-clipping output. */
export type ForecastVariant = "raw" | "usable";

/**
 * Shape one view of a {@link SolarForecast} for external export: pick the `raw`
 * (uncurtailed) or `usable` (post-clipping) view, then append the Solcast-style
 * `detailedForecast`, turning each slot's plant-local `YYYY-MM-DDTHH:mm` into a
 * full offset-aware ISO timestamp (e.g. `2026-07-24T11:15:00+02:00`).
 */
export function toForecastExport(
  forecast: SolarForecast,
  variant: ForecastVariant,
): SolarForecastExport {
  const { provider, stepMinutes, utcOffsetSeconds, raw, ...usable } = forecast;
  const view: ForecastView = variant === "raw" ? raw : usable;
  const offset = isoOffset(utcOffsetSeconds);
  return {
    provider,
    stepMinutes,
    utcOffsetSeconds,
    ...view,
    detailedForecast: view.series.map((p) => ({
      period_start: `${p.time}:00${offset}`,
      watts: p.watts,
    })),
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

/**
 * Measured battery SOC at the series' first slot (plant-local midnight), read
 * from the hourly rollups — lets the clipping sim reconstruct the *past* part
 * of the day instead of leaving it uncurtailed. `null` when the plant maps no
 * SOC metric or no rollup covers that hour.
 */
async function resolveDayStartSoc(data: IrradianceForecast): Promise<number | null> {
  const [{ getActiveProfileOrNull }, { liveState }, { queryHourlyAvgRange }] = await Promise.all([
    import("./inverter"),
    import("./state"),
    import("./history"),
  ]);
  const profile = getActiveProfileOrNull();
  const socKey = profile?.metrics.find((m) => m.role === "battery.soc")?.key;
  const startLocal = data.times[0];
  if (!profile || !socKey || startLocal === undefined) return null;
  const startMs = Date.parse(`${startLocal}:00Z`) - data.utcOffsetSeconds * 1000;
  const rows = await queryHourlyAvgRange(
    socKey,
    liveState.latest?.inverterId ?? profile.id,
    new Date(startMs),
    new Date(startMs + 3_600_000),
  );
  const avg = rows[0]?.avg;
  return typeof avg === "number" && Number.isFinite(avg) ? avg : null;
}

/**
 * The learned correction model to apply, or `undefined` when correction is
 * disabled, no profile is active, or nothing has been learned yet. Lazily
 * imported (like the sim inputs) so this pure model file stays free of the
 * DB/env at import time.
 */
async function resolveCorrection(config: WeatherConfig): Promise<CorrectionModel | undefined> {
  if (!config.forecast.correction.enabled) return undefined;
  const [{ getActiveProfileOrNull }, { liveState }, { loadCorrectionModel }] = await Promise.all([
    import("./inverter"),
    import("./state"),
    import("./forecast-correction-store"),
  ]);
  const profile = getActiveProfileOrNull();
  if (!profile) return undefined;
  const model = await loadCorrectionModel(liveState.latest?.inverterId ?? profile.id);
  return model.size > 0 ? model : undefined;
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
  // The learned correction (when enabled) rides alongside it.
  const [sim, correction] = await Promise.all([
    clippingConfigured(config.forecast) ? resolveSimInputs(config) : undefined,
    resolveCorrection(config),
  ]);

  // Day-start SOC needs the series' own time base, so it resolves per build
  // (one indexed rollup row) once the irradiance data is at hand; it only
  // matters when a battery participates in the clipping sim.
  const build = async (data: IrradianceForecast, providerId: string): Promise<SolarForecast> => {
    const simInputs =
      sim && config.forecast.battery != null
        ? { ...sim, dayStartSocPct: await resolveDayStartSoc(data) }
        : sim;
    return buildSolarForecast(config.forecast, data, providerId, Date.now(), simInputs, correction);
  };

  const key = JSON.stringify([config.latitude, config.longitude, config.forecast]);
  if (cache !== null && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return build(cache.data, cache.provider);
  }

  try {
    const data = await provider.fetch(
      { latitude: config.latitude, longitude: config.longitude },
      config.forecast.arrays.map(({ tilt, azimuth }) => ({ tilt, azimuth })),
    );
    cache = { key, at: Date.now(), data, provider: provider.id };
    return build(data, provider.id);
  } catch (err) {
    logger.warn("fetch failed: {error}", { error: err instanceof Error ? err.message : err });
    return cache?.key === key ? build(cache.data, cache.provider) : null;
  }
}
