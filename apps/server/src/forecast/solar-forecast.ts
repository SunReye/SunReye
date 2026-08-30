/**
 * PV production forecast for the dashboard's weather tile.
 *
 * Split so new data sources stay cheap to add: a {@link SolarIrradianceProvider}
 * only delivers hourly plane-of-array irradiance + ambient temperature for the
 * plant's location; the per-array power model ({@link ./pv-model}) is
 * provider-agnostic, and the assembly here turns any provider's series into
 * per-slot AC watts, the feed-in/battery clipping pass, and daily kWh sums.
 * Open-Meteo is the default provider; register additions in {@link PROVIDERS}.
 */

import { type WeatherConfig, forecastReady } from "@SunReye/db/weather";
import type { DeviceInstance, InverterSample, RoleKey } from "@SunReye/inverter-core";
import { HOUR_MS, flowStep } from "../energy/energy-flow";
import { type CorrectionModel, correctionFactor, hourOf, monthOf } from "./forecast-correction";
import { log } from "../shared/logging";
import { STC_CELL_TEMP_C, pvPowerW } from "./pv-model";
import { cosAoi, sunPosition } from "./solar-geometry";
import { openMeteoIrradiance } from "./providers/open-meteo";

const logger = log("solar-forecast");

/** `v` when it is a usable number, else null. */
const finiteOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * A device's metric key for a canonical role; undefined when it maps none.
 *
 * Through the CONTRACT (`DeviceInstance.roles`) rather than by scanning a
 * profile's metric list: the forecast needs two roles and an id, and asking a
 * device for a role is the one question that answers the same way whoever
 * authored the mapping.
 */
const roleKey = (device: DeviceInstance | null, role: RoleKey): string | undefined =>
  device?.roles.get(role)?.metrics[0]?.key;

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

/**
 * Which optional inputs a provider actually supplies — the two that change the
 * physics. `dni` enables the beam/diffuse incidence-angle (IAM) split;
 * `windSpeed` enables the Faiman cell-temperature model (both consumed in
 * {@link instantPowerW}). A provider that can't deliver one leaves it `false`
 * and the model falls back (flat system loss / static NOCT rise).
 */
export interface ProviderCapabilities {
  dni: boolean;
  windSpeed: boolean;
}

export interface SolarIrradianceProvider {
  readonly id: string;
  /** Human-readable name the settings dropdown renders. */
  readonly label: string;
  /** The optional series this provider resolves — feeds the settings form. */
  readonly capabilities: ProviderCapabilities;
  fetch(
    location: { latitude: number; longitude: number },
    planes: PlaneOfArray[],
  ): Promise<IrradianceForecast>;
}

/** Registered providers; the config's `forecast.provider` picks one. */
const PROVIDERS: Record<string, SolarIrradianceProvider> = {
  [openMeteoIrradiance.id]: openMeteoIrradiance,
};

/** Provider ids, labels, and capability flags — drives the settings form. */
export function forecastProviderCatalog(): {
  id: string;
  label: string;
  capabilities: ProviderCapabilities;
}[] {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    capabilities: p.capabilities,
  }));
}

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
  /**
   * Average AC output over the 15-minute window, W — the same quantity the
   * chart bars draw. `avgPowerW / 1000 × 0.25 h` equals {@link energyKwh}, so a
   * tile showing this reads consistently with its own kWh sub-line and the
   * chart's first bar (issue #49). Runs below {@link maxPowerW} on a spiky slot.
   */
  avgPowerW: number;
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

/**
 * One slot of the plant's energy flow — the shared {@link flowStep} physics
 * under the pack's own bounds (no automation ceilings). Returns the *usable*
 * AC output (raw PV minus curtailment) and the battery's new energy content,
 * so the caller can carry state to the next slot. On a PV deficit the battery
 * discharges to cover the shortfall (down to its reserve), which reclaims
 * headroom for later slots and, crucially, overnight for the next day.
 */
function simulateStep(
  pvW: number,
  loadW: number,
  socKwh: number,
  caps: ClipCaps,
  dtH: number,
): { usefulW: number; socKwh: number } {
  const flows = flowStep(pvW, loadW, dtH, {
    chargeCeilingW: caps.batteryMaxChargeW,
    headroomKwh: caps.batteryCapKwh - socKwh,
    aboveFloorKwh: socKwh - caps.batteryMinKwh,
    exportCeilingW: caps.maxOutputW,
  });
  return {
    usefulW: Math.max(0, pvW) - flows.curtailedW,
    socKwh: socKwh + ((flows.chargeW - flows.dischargeW) * dtH) / 1000,
  };
}

/**
 * Peak power, average power, and energy over the 15 minutes after `now`, from
 * the (already clipped) series. Energy is the time-weighted sum of the slots
 * the window overlaps; the peak is the largest per-slot peak among them; the
 * average is the energy spread over the fixed 15-minute window, so it equals
 * the slot watts for a fully-covered single slot and keeps `avg × 0.25 h == kWh`.
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
  // Average over the whole 15-minute window (0.25 h): energyKwh → W.
  const avgPowerW = (energyKwh / (15 / 60)) * 1000;
  return { maxPowerW, avgPowerW, energyKwh };
}

/** Slot geometry for a series: each sample's start instant and the slot it opens. */
interface SlotGrid {
  startMs: number[];
  widthMs: number[];
}

/**
 * Each sample opens the slot [tᵢ, tᵢ₊₁); its width is the gap to the next
 * sample, capped at one hour so sparse/gappy series (a DST seam, a provider
 * hiccup) degrade to hour-wide point samples instead of smearing one sample
 * across the gap. The last sample inherits the preceding width.
 */
function slotGrid(times: string[], utcOffsetSeconds: number): SlotGrid {
  const startMs = times.map((t) => Date.parse(`${t}:00Z`) - utcOffsetSeconds * 1000);
  const widthMs = startMs.map((s, i) => {
    const next = startMs[i + 1];
    if (next !== undefined) return Math.min(Math.max(1, next - s), HOUR_MS);
    const previous = startMs[i - 1];
    return previous === undefined ? HOUR_MS : Math.min(Math.max(1, s - previous), HOUR_MS);
  });
  return { startMs, widthMs };
}

/**
 * Instantaneous AC power at each timestamp, summed over the configured arrays:
 * sun position feeds the per-array incidence angle so the IAM split (when DNI is
 * available) can bite. A learned correction (when supplied) then scales the
 * sample by its (month, hour) factor.
 *
 * Each array is modelled with ITS OWN temperature coefficient and system loss,
 * falling back to the plant's. The model's seam was always per array; it used to
 * be handed the same plant-wide pair eight times over, so a shaded east string
 * and a clean south one shared one 14 % — the fudge factor
 * `./forecast-correction.ts` then had to learn its way out of.
 */
function instantPowerW(
  config: WeatherConfig["forecast"],
  data: IrradianceForecast,
  correction?: CorrectionModel,
): number[] {
  return data.times.map((time, i) => {
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
        // `??`, never `||`: 0 %/°C and 0 % loss are legal STATEMENTS about a
        // string, and `||` would swap either for the plant default silently.
        // The plant column is the fallback and stays the answer for the uniform
        // single-array plant that never states anything per array.
        arr.tempCoefficient ?? config.tempCoefficient,
        arr.systemLoss ?? config.systemLoss,
      );
    });
    return correction ? watts * correctionFactor(correction, monthOf(time), hourOf(time)) : watts;
  });
}

/**
 * Average power over each slot [tᵢ, tᵢ₊₁), via the trapezoid of its endpoints.
 * This is what makes a forecast bar line up with the energy actually accumulated
 * during that same slot: sampling a single endpoint instead biases the steep
 * limbs — over-reporting the sunset ramp and under-reporting the sunrise ramp.
 * Only genuinely adjacent samples (gap within the hour cap) are integrated;
 * anything else falls back to the point sample. The per-slot peak is the larger
 * endpoint — what the UI reports as "max power" for the slot.
 */
function integrateSlots(times: string[], instW: number[], grid: SlotGrid): SolarForecastPoint[] {
  const adjacent = (i: number): boolean => {
    const next = grid.startMs[i + 1];
    return next !== undefined && next - (grid.startMs[i] ?? 0) <= HOUR_MS;
  };
  return times.map((time, i) => {
    const w = instW[i] ?? 0;
    const paired = adjacent(i);
    const nextW = paired ? (instW[i + 1] ?? w) : w;
    return { time, watts: paired ? (w + nextW) / 2 : w, peakWatts: Math.max(w, nextW) };
  });
}

/** What the clipping pass needs beyond the raw series and its slot grid. */
interface ClipRun {
  caps: ClipCaps;
  loadW: number;
  /** Battery energy the sim starts the series from, kWh. */
  socKwh: number;
  /** Past slots participate (day-start SOC known, or no battery to model). */
  simPast: boolean;
  /** Measured live SOC to re-seed with at the past→future seam, %; null keeps the sim's. */
  reseedSocPct: number | null;
  nowMs: number;
}

/** Whether past slots can be simulated: their battery state is known (measured
 *  day-start SOC) or irrelevant (no battery — the feed-in cap alone clips). */
const simulatesPast = (caps: ClipCaps, sim?: ForecastSimInputs): boolean =>
  caps.batteryCapKwh === 0 || sim?.dayStartSocPct != null;

/** SOC the sim starts the series from, %. Unknown → the battery's reserve floor
 *  (full headroom), so we never invent curtailment we can't justify. */
function seedSocPct(
  config: WeatherConfig["forecast"],
  sim: ForecastSimInputs | undefined,
  simPast: boolean,
): number {
  const live = sim?.startSocPct ?? config.battery?.minSoc ?? 0;
  return simPast ? (sim?.dayStartSocPct ?? live) : live;
}

/** Seed the clipping pass from the plant config and the live/measured SOC inputs. */
function clipRun(
  config: WeatherConfig["forecast"],
  caps: ClipCaps,
  sim: ForecastSimInputs | undefined,
  nowMs: number,
): ClipRun {
  const simPast = simulatesPast(caps, sim);
  return {
    caps,
    loadW: sim?.houseLoadW ?? 0,
    socKwh: caps.batteryCapKwh * (seedSocPct(config, sim, simPast) / 100),
    simPast,
    // Without a reconstructed past there is nothing to re-seed — the sim already
    // started from the live reading.
    reseedSocPct: simPast ? (sim?.startSocPct ?? null) : null,
    nowMs,
  };
}

/** Clipping caps instantaneous output too: scale the slot peak by its usable share. */
const clippedPeakW = (point: SolarForecastPoint, usefulW: number): number =>
  point.watts > 0 ? point.peakWatts * (usefulW / point.watts) : usefulW;

/**
 * The usable view: raw PV with the feed-in cap + battery model curtailing the
 * surplus. Past slots keep the raw estimate unless {@link ClipRun.simPast} lets
 * the sim reconstruct them. At the past→future seam the simulated SOC yields to
 * the measured one — forecast weather drifts from what actually fell, and the
 * live reading is truth for everything still ahead.
 */
function clipSeries(raw: SolarForecastPoint[], grid: SlotGrid, run: ClipRun): SolarForecastPoint[] {
  let socKwh = run.socKwh;
  let reseeded = false;
  return raw.map((point, i) => {
    const width = grid.widthMs[i] ?? HOUR_MS;
    const isPast = (grid.startMs[i] ?? 0) + width <= run.nowMs;
    if (isPast && !run.simPast) return point;
    if (!isPast && !reseeded) {
      reseeded = true;
      if (run.reseedSocPct !== null) socKwh = run.caps.batteryCapKwh * (run.reseedSocPct / 100);
    }
    const step = simulateStep(point.watts, run.loadW, socKwh, run.caps, width / HOUR_MS);
    socKwh = step.socKwh;
    return { time: point.time, watts: step.usefulW, peakWatts: clippedPeakW(point, step.usefulW) };
  });
}

/** Energy in slot `i` of `series`, kWh. */
const slotKwh = (series: SolarForecastPoint[], grid: SlotGrid, i: number): number =>
  ((series[i]?.watts ?? 0) * (grid.widthMs[i] ?? 0)) / HOUR_MS / 1000;

/** The plant-local calendar days the daily sums bucket into. */
interface LocalDays {
  today: string;
  tomorrow: string;
}

/** The plant-local `today`/`tomorrow` date keys at `nowMs`. */
function localDays(nowMs: number, utcOffsetSeconds: number): LocalDays {
  const localMs = nowMs + utcOffsetSeconds * 1000;
  return {
    today: new Date(localMs).toISOString().slice(0, 10),
    tomorrow: new Date(localMs + 24 * HOUR_MS).toISOString().slice(0, 10),
  };
}

/**
 * Daily/near-term sums for one series, bucketed by the plant's local day.
 * "Remaining" includes the running slot prorated by the fraction of it still
 * ahead, so an 11:30 view with hourly slots counts half of the 11:00 slot
 * instead of the whole hour.
 */
function viewOf(
  series: SolarForecastPoint[],
  grid: SlotGrid,
  nowMs: number,
  days: LocalDays,
): ForecastView {
  const dayKwh = (day: string): number =>
    series.reduce(
      (sum, p, i) => (p.time.startsWith(day) ? sum + slotKwh(series, grid, i) : sum),
      0,
    );
  return {
    series,
    todayKwh: dayKwh(days.today),
    remainingTodayKwh: series.reduce((sum, p, i) => {
      if (!p.time.startsWith(days.today)) return sum;
      const width = grid.widthMs[i] ?? 0;
      const left = Math.min((grid.startMs[i] ?? 0) + width - nowMs, width);
      return left <= 0 ? sum : sum + slotKwh(series, grid, i) * (left / width);
    }, 0),
    tomorrowKwh: dayKwh(days.tomorrow),
    next15: computeNext15(series, grid.startMs, grid.widthMs, nowMs),
  };
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
  const grid = slotGrid(data.times, data.utcOffsetSeconds);
  // The raw (uncurtailed) PV potential, straight from the power model.
  const rawSeries = integrateSlots(data.times, instantPowerW(config, data, correction), grid);

  // Run the clipping model only when something can actually clip; otherwise the
  // forecast is the raw PV estimate, identical to before this feature.
  const caps = clipCaps(config);
  const clippingOn = caps.maxOutputW < Number.POSITIVE_INFINITY || caps.batteryCapKwh > 0;
  const usableSeries = clippingOn
    ? clipSeries(rawSeries, grid, clipRun(config, caps, sim, nowMs))
    : rawSeries;

  const days = localDays(nowMs, data.utcOffsetSeconds);
  return {
    provider,
    stepMinutes: Math.round(Math.min(...grid.widthMs, HOUR_MS) / 60_000),
    utcOffsetSeconds: data.utcOffsetSeconds,
    ...viewOf(usableSeries, grid, nowMs, days),
    raw: viewOf(rawSeries, grid, nowMs, days),
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

/** Live battery SOC from the poll cache, %; null when unmapped or unavailable. */
function liveSocPct(device: DeviceInstance | null, sample: InverterSample | null): number | null {
  const key = roleKey(device, "battery.soc");
  return finiteOrNull(key ? sample?.metrics[key] : undefined);
}

/**
 * A representative house load, W: the cached 14-day median of the load metric,
 * recomputed once past its (long) TTL. `null` when the plant maps no load
 * metric or the rollups have nothing yet.
 */
async function medianHouseLoadW(device: DeviceInstance): Promise<number | null> {
  if (loadCache && Date.now() - loadCache.at < LOAD_MEDIAN_TTL_MS) return loadCache.watts;
  const loadKey = roleKey(device, "load.power");
  const { queryMedianHourlyAvg } = await import("../shared/history");
  const watts = loadKey ? await queryMedianHourlyAvg(loadKey, device.id, LOAD_MEDIAN_DAYS) : null;
  loadCache = { at: Date.now(), watts };
  return watts;
}

/**
 * The house load any whole-day model should assume, W: the config override
 * first, else the cached 14-day median of the load metric. `null` when the
 * plant offers neither. Shared with the peak-shaving automation so its
 * thresholds sit in the same feed-in frame as the clipping model here.
 */
// fallow-ignore-next-line unused-export -- consumed by ./automation through a destructured dynamic `import("./solar-forecast")`, which isn't traced
export async function representativeHouseLoadW(config: WeatherConfig): Promise<number | null> {
  if (config.forecast.houseLoadW != null) return config.forecast.houseLoadW;
  const { deviceRegistry } = await import("../devices/registry-instance");
  const device = deviceRegistry.primary();
  if (!device) return null;
  return await medianHouseLoadW(device);
}

/**
 * Live SOC + house load for the clipping model (a config load override wins).
 * The `./inverter`, `./state` and `./history` deps are imported lazily so this
 * file's pure model stays importable without the server env / DB — mirroring
 * the DB-free split used by {@link ../energy/energy-calc}.
 */
async function resolveSimInputs(config: WeatherConfig): Promise<ForecastSimInputs> {
  const [{ deviceRegistry }, { liveState }] = await Promise.all([
    import("../devices/registry-instance"),
    import("../shared/state"),
  ]);
  return {
    startSocPct: liveSocPct(deviceRegistry.primary(), liveState.latest),
    houseLoadW: await representativeHouseLoadW(config),
  };
}

/**
 * Measured battery SOC at the series' first slot (plant-local midnight), read
 * from the hourly rollups — lets the clipping sim reconstruct the *past* part
 * of the day instead of leaving it uncurtailed. `null` when the plant maps no
 * SOC metric or no rollup covers that hour.
 */
async function resolveDayStartSoc(data: IrradianceForecast): Promise<number | null> {
  const [{ deviceRegistry }, { queryHourlyAvgRange }] = await Promise.all([
    import("../devices/registry-instance"),
    import("../shared/history"),
  ]);
  const device = deviceRegistry.primary();
  const socKey = roleKey(device, "battery.soc");
  const startLocal = data.times[0];
  if (!device || !socKey || startLocal === undefined) return null;
  const startMs = Date.parse(`${startLocal}:00Z`) - data.utcOffsetSeconds * 1000;
  const rows = await queryHourlyAvgRange(
    socKey,
    device.id,
    new Date(startMs),
    new Date(startMs + HOUR_MS),
  );
  return finiteOrNull(rows[0]?.avg);
}

/**
 * The learned correction model to apply, or `undefined` when correction is
 * disabled, no profile is active, or nothing has been learned yet. Lazily
 * imported (like the sim inputs) so this pure model file stays free of the
 * DB/env at import time.
 */
async function resolveCorrection(config: WeatherConfig): Promise<CorrectionModel | undefined> {
  if (!config.forecast.correction.enabled) return undefined;
  const [{ deviceRegistry }, { loadCorrectionModel }] = await Promise.all([
    import("../devices/registry-instance"),
    import("./forecast-correction-store"),
  ]);
  const device = deviceRegistry.primary();
  if (!device) return undefined;
  const model = await loadCorrectionModel(device.id);
  return model.size > 0 ? model : undefined;
}

/** How long fetched irradiance is reused before hitting the provider again. */
const CACHE_TTL_MS = 30 * 60 * 1000;

// The cache holds the provider's raw irradiance, not the finished forecast:
// today/remaining sums depend on "now", so they are rebuilt on every request
// (cheap — 48 hours × arrays) instead of being frozen for the TTL.
let cache: { key: string; at: number; data: IrradianceForecast; provider: string } | null = null;

/** A cache hit: the provider's raw irradiance plus which provider produced it. */
type CachedIrradiance = { data: IrradianceForecast; provider: string };

/** The cached irradiance for `key` while still inside the TTL, else `null`. */
function freshCache(key: string, nowMs: number): CachedIrradiance | null {
  if (cache === null || cache.key !== key || nowMs - cache.at >= CACHE_TTL_MS) return null;
  return cache;
}

/**
 * Assemble the finished forecast from raw irradiance. Day-start SOC needs the
 * series' own time base, so it resolves here (one indexed rollup row) rather
 * than with the other sim inputs; it only matters when a battery participates
 * in the clipping sim.
 */
async function buildWithDayStartSoc(
  config: WeatherConfig,
  { data, provider }: CachedIrradiance,
  sim: ForecastSimInputs | undefined,
  correction: CorrectionModel | undefined,
): Promise<SolarForecast> {
  const simInputs =
    sim && config.forecast.battery != null
      ? { ...sim, dayStartSocPct: await resolveDayStartSoc(data) }
      : sim;
  return buildSolarForecast(config.forecast, data, provider, Date.now(), simInputs, correction);
}

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
  const build = (hit: CachedIrradiance) => buildWithDayStartSoc(config, hit, sim, correction);

  const key = JSON.stringify([config.latitude, config.longitude, config.forecast]);
  const cached = freshCache(key, Date.now());
  if (cached) return build(cached);

  try {
    const data = await provider.fetch(
      { latitude: config.latitude, longitude: config.longitude },
      config.forecast.arrays.map(({ tilt, azimuth }) => ({ tilt, azimuth })),
    );
    cache = { key, at: Date.now(), data, provider: provider.id };
    return build({ data, provider: provider.id });
  } catch (err) {
    logger.warn("fetch failed: {error}", { error: err instanceof Error ? err.message : err });
    // A stale entry for this same key still beats no forecast at all.
    return cache?.key === key ? build(cache) : null;
  }
}
