/**
 * Oracle group 6 — PV forecast.
 *
 * Solar geometry, the per-array power model, and the assembled forecast exported raw and usable,
 * each over fixed inputs (irradiance series, location, arrays, `nowMs`, sim inputs, correction
 * model). Irradiance is a synthetic curve computed here from the slot's clock: the forecast model
 * is what is recorded, not a provider.
 */
import type {
  CorrectionCell,
  CorrectionModel,
} from "../../apps/server/src/forecast/forecast-correction";
import type {
  ForecastSimInputs,
  IrradianceForecast,
  buildSolarForecast as BuildSolarForecast,
} from "../../apps/server/src/forecast/solar-forecast";
import type { PvSample } from "../../apps/server/src/forecast/pv-model";

import { type CorpusFiles, ndjson } from "./corpus";

type ForecastConfig = Parameters<typeof BuildSolarForecast>[0];
type PvArray = ForecastConfig["arrays"][number];

const HOUR_MS = 3_600_000;
const ZONE = "Europe/Berlin";
const LIMBURG = { latitude: 50.39, longitude: 8.06 };

interface GeometryCase {
  case: string;
  producer: "sunPosition";
  input: {
    latitude: number;
    longitude: number;
    atMs: number;
    planes: Array<{ tilt: number; azimuth: number }>;
  };
}

interface PowerCase {
  case: string;
  producer: "pvPowerW";
  input: { sample: PvSample; kwp: number; tempCoefficient: number; systemLoss: number };
}

interface ForecastCase {
  case: string;
  producer: "buildSolarForecast";
  input: {
    config: ForecastConfig;
    data: IrradianceForecast;
    provider: string;
    timeZone: string;
    nowMs: number;
    sim?: ForecastSimInputs;
    /** `cellKey` (`month:hour`) to cell. */
    correction?: Record<string, CorrectionCell>;
  };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Plant-local `YYYY-MM-DDTHH:mm` of an instant at a fixed UTC offset. */
const localLabel = (ms: number, offsetSeconds: number): string =>
  new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 16);

interface SeriesShape {
  /** First sample, UTC. */
  startMs: number;
  stepMinutes: number;
  count: number;
  utcOffsetSeconds: number;
  /** Peak plane irradiance per plane, W/m²; each plane's curve peaks `shiftH` hours from solar noon. */
  planes: Array<{ peak: number; shiftH: number }>;
  dni: boolean;
  wind: boolean;
  /** Sample indexes left out (a provider gap). */
  skip?: (i: number) => boolean;
  /** Plane irradiance added to every sample, W/m²: lets night slots carry energy. */
  baseWm2?: number;
}

/**
 * A clear-sky-like bell per plane over the UTC hour, the second day dimmer. Values are rounded so
 * the fixture reads like provider data.
 */
function series(shape: SeriesShape): IrradianceForecast {
  const index: number[] = [];
  for (let i = 0; i < shape.count; i++) if (!shape.skip?.(i)) index.push(i);
  const at = index.map((i) => shape.startMs + i * shape.stepMinutes * 60_000);
  const utcHour = (ms: number): number => (ms % (24 * HOUR_MS)) / HOUR_MS;
  const dim = (ms: number): number => (ms - shape.startMs >= 24 * HOUR_MS ? 0.6 : 1);
  const bell = (ms: number, peak: number, shiftH: number): number =>
    round1(Math.max(0, peak * Math.sin((Math.PI * (utcHour(ms) - 3.5 - shiftH)) / 15)) * dim(ms));
  return {
    times: at.map((ms) => localLabel(ms, shape.utcOffsetSeconds)),
    utcOffsetSeconds: shape.utcOffsetSeconds,
    location: LIMBURG,
    temperature: at.map((ms) => round1(12 + 10 * Math.sin((Math.PI * (utcHour(ms) - 6)) / 18))),
    gti: shape.planes.map((p) => at.map((ms) => bell(ms, p.peak, p.shiftH) + (shape.baseWm2 ?? 0))),
    ...(shape.dni ? { dni: at.map((ms) => bell(ms, 820, 0)) } : {}),
    ...(shape.wind ? { windSpeed: at.map((_ms, k) => round1(0.5 + ((k * 7) % 11) * 0.4)) } : {}),
  };
}

const config = (over: Partial<ForecastConfig> = {}): ForecastConfig => ({
  enabled: true,
  provider: "open-meteo",
  arrays: [{ kwp: 10, tilt: 30, azimuth: 0 }],
  tempCoefficient: -0.4,
  systemLoss: 14,
  maxOutputW: null,
  battery: null,
  houseLoadW: null,
  smartMeterSince: null,
  correction: { enabled: false },
  ...over,
});

const battery = (over: Partial<NonNullable<ForecastConfig["battery"]>> = {}) => ({
  usableKwh: 10,
  maxChargeW: 5000,
  minSoc: 10,
  nominalV: null,
  ...over,
});

const SOUTH: PvArray = { kwp: 10, tilt: 30, azimuth: 0 };
const EAST: PvArray = { kwp: 4, tilt: 20, azimuth: -90 };

/** 2026-07-24 00:00 Berlin (+02:00), two days. */
const JULY = Date.UTC(2026, 6, 23, 22);
const julyQuarter = (over: Partial<SeriesShape> = {}): IrradianceForecast =>
  series({
    startMs: JULY,
    stepMinutes: 15,
    count: 192,
    utcOffsetSeconds: 7200,
    planes: [{ peak: 880, shiftH: 0 }],
    dni: true,
    wind: true,
    ...over,
  });
const julyHourly = (over: Partial<SeriesShape> = {}): IrradianceForecast =>
  series({
    startMs: JULY,
    stepMinutes: 60,
    count: 48,
    utcOffsetSeconds: 7200,
    planes: [{ peak: 880, shiftH: 0 }],
    dni: false,
    wind: false,
    ...over,
  });
/** 2026-07-24 at a Berlin wall clock. */
const julyAt = (hour: number, minute = 0): number => JULY + hour * HOUR_MS + minute * 60_000;

const geometry = (
  name: string,
  latitude: number,
  longitude: number,
  atMs: number,
): GeometryCase => ({
  case: `geometry/${name}`,
  producer: "sunPosition",
  input: {
    latitude,
    longitude,
    atMs,
    planes: [
      { tilt: 30, azimuth: 0 },
      { tilt: 20, azimuth: -90 },
      { tilt: 45, azimuth: 90 },
      { tilt: 90, azimuth: 180 },
      { tilt: 0, azimuth: 0 },
    ],
  },
});

const GEOMETRY: GeometryCase[] = [
  geometry("summer-noon", LIMBURG.latitude, LIMBURG.longitude, Date.UTC(2026, 5, 21, 11, 30)),
  geometry("winter-morning", LIMBURG.latitude, LIMBURG.longitude, Date.UTC(2026, 11, 21, 8, 15)),
  geometry("evening-west", LIMBURG.latitude, LIMBURG.longitude, Date.UTC(2026, 6, 24, 18, 45, 30)),
  geometry("night", LIMBURG.latitude, LIMBURG.longitude, Date.UTC(2026, 6, 24, 23, 0)),
  geometry("southern-hemisphere", -33.87, 151.21, Date.UTC(2026, 0, 15, 2, 0)),
];

const power = (
  name: string,
  sample: PvSample,
  tempCoefficient = -0.4,
  systemLoss = 14,
): PowerCase => ({
  case: `power/${name}`,
  producer: "pvPowerW",
  input: { sample, kwp: 8.5, tempCoefficient, systemLoss },
});

const POWER: PowerCase[] = [
  power("no-dni-no-wind", { gtiWm2: 742.5, ambientC: 21.3 }),
  power("iam-split", { gtiWm2: 742.5, ambientC: 21.3, dniWm2: 690, cosAoi: 0.81 }),
  power("iam-glancing", { gtiWm2: 180, ambientC: 9, dniWm2: 410, cosAoi: 0.12 }),
  power("iam-beam-capped-by-gti", { gtiWm2: 300, ambientC: 15, dniWm2: 900, cosAoi: 0.9 }),
  power("sun-behind-plane", { gtiWm2: 95, ambientC: 15, dniWm2: 600, cosAoi: -0.2 }),
  power("faiman-wind", { gtiWm2: 742.5, ambientC: 21.3, windMs: 4.2 }),
  power("faiman-calm", { gtiWm2: 742.5, ambientC: 21.3, windMs: 0 }),
  power("iam-and-faiman", { gtiWm2: 742.5, ambientC: 21.3, dniWm2: 690, cosAoi: 0.81, windMs: 2 }),
  power("dni-without-cos-aoi", { gtiWm2: 742.5, ambientC: 21.3, dniWm2: 690 }),
  power("zero-coefficient-zero-loss", { gtiWm2: 742.5, ambientC: 35 }, 0, 0),
  power("cold-gain", { gtiWm2: 520, ambientC: -12 }, -0.35, 9),
  power("derate-floor", { gtiWm2: 1000, ambientC: 60 }, -2, 14),
  power("night", { gtiWm2: 0, ambientC: 10, dniWm2: 0, cosAoi: -0.5, windMs: 3 }),
  power("negative-gti", { gtiWm2: -3, ambientC: 10 }),
];

const forecast = (
  name: string,
  input: Omit<ForecastCase["input"], "provider" | "timeZone"> & { timeZone?: string },
): ForecastCase => ({
  case: `forecast/${name}`,
  producer: "buildSolarForecast",
  input: { provider: "open-meteo", timeZone: ZONE, ...input },
});

/** 2026-03-29 00:00 Berlin, +01:00; the day is 23 hours. */
const SPRING = Date.UTC(2026, 2, 28, 23);
/** 2025-10-26 00:00 Berlin, +02:00; the day is 25 hours. */
const AUTUMN = Date.UTC(2025, 9, 25, 22);
/**
 * `nowMs` at 00:30 plant time falls on the previous UTC date, and night slots carry energy from six
 * hours before plant midnight, so every plant-day edge moves `todayKwh` or `tomorrowKwh`.
 */
const DST_START_H = -6;

const FORECAST: ForecastCase[] = [
  forecast("quarter-hour-grid", { config: config(), data: julyQuarter(), nowMs: julyAt(9, 40) }),
  forecast("hourly-grid", { config: config(), data: julyHourly(), nowMs: julyAt(9, 40) }),
  forecast("gap-over-an-hour", {
    config: config(),
    data: julyQuarter({ skip: (i) => i >= 44 && i < 56 }),
    nowMs: julyAt(8),
  }),
  forecast("dst-spring-berlin", {
    config: config(),
    data: series({
      startMs: SPRING + DST_START_H * HOUR_MS,
      stepMinutes: 15,
      count: 192,
      utcOffsetSeconds: 3600,
      planes: [{ peak: 700, shiftH: 0 }],
      dni: true,
      wind: true,
      baseWm2: 40,
    }),
    nowMs: SPRING + HOUR_MS / 2,
  }),
  forecast("dst-autumn-berlin", {
    config: config(),
    data: series({
      startMs: AUTUMN + DST_START_H * HOUR_MS,
      stepMinutes: 60,
      count: 56,
      utcOffsetSeconds: 7200,
      planes: [{ peak: 600, shiftH: 0 }],
      dni: false,
      wind: true,
      baseWm2: 40,
    }),
    nowMs: AUTUMN + HOUR_MS / 2,
  }),
  forecast("empty-series", {
    config: config({ maxOutputW: 4000, battery: battery() }),
    data: julyQuarter({ count: 0 }),
    nowMs: julyAt(12),
    sim: { startSocPct: 55, houseLoadW: 450 },
  }),
  forecast("sun-behind-plane", {
    config: config({ arrays: [{ kwp: 6, tilt: 70, azimuth: 180 }] }),
    data: julyQuarter({ planes: [{ peak: 140, shiftH: 0 }] }),
    nowMs: julyAt(12),
  }),
  forecast("no-arrays", {
    config: config({ arrays: [] }),
    data: julyHourly({ planes: [] }),
    nowMs: julyAt(12),
  }),
  forecast("per-array-overrides", {
    config: config({
      arrays: [
        SOUTH,
        { ...EAST, tempCoefficient: 0, systemLoss: 0 },
        { ...SOUTH, kwp: 3, systemLoss: 25 },
      ],
    }),
    data: julyQuarter({
      planes: [
        { peak: 880, shiftH: 0 },
        { peak: 760, shiftH: -2.5 },
        { peak: 880, shiftH: 0 },
      ],
    }),
    nowMs: julyAt(10, 5),
  }),
  forecast("feed-in-cap-only", {
    config: config({ maxOutputW: 4000 }),
    data: julyQuarter(),
    nowMs: julyAt(11, 20),
    sim: { startSocPct: null, houseLoadW: 600 },
  }),
  forecast("battery-live-soc", {
    config: config({ maxOutputW: 4000, battery: battery() }),
    data: julyQuarter(),
    nowMs: julyAt(11, 20),
    sim: { startSocPct: 55, houseLoadW: 450 },
  }),
  forecast("battery-day-start-soc", {
    config: config({ maxOutputW: 4000, battery: battery() }),
    data: julyQuarter(),
    nowMs: julyAt(11, 20),
    sim: { startSocPct: 55, houseLoadW: 450, dayStartSocPct: 50 },
  }),
  forecast("battery-unknown-soc", {
    config: config({ maxOutputW: 4000, battery: battery({ maxChargeW: null, minSoc: 20 }) }),
    data: julyHourly(),
    nowMs: julyAt(14, 45),
    sim: { startSocPct: null, houseLoadW: null },
  }),
  forecast("battery-without-sim-inputs", {
    config: config({ battery: battery({ usableKwh: 5 }) }),
    data: julyHourly(),
    nowMs: julyAt(7),
  }),
  forecast("learned-correction", {
    config: config(),
    data: julyQuarter(),
    nowMs: julyAt(9, 40),
    correction: {
      "7:9": { ratio: 0.82, weight: 12 },
      "7:12": { ratio: 1.1, weight: 3.5 },
      "7:13": { ratio: 2.4, weight: 40 },
      "7:17": { ratio: 0.3, weight: 25 },
      "8:12": { ratio: 0.5, weight: 30 },
    },
  }),
  forecast("next15-across-slot-boundary", {
    config: config({ maxOutputW: 5000 }),
    data: julyQuarter(),
    nowMs: julyAt(12, 7) + 30_000,
  }),
  forecast("remaining-today-mid-slot", {
    config: config(),
    data: julyHourly(),
    nowMs: julyAt(11, 30),
  }),
];

const correctionModel = (cells: Record<string, CorrectionCell>): CorrectionModel =>
  new Map(Object.entries(cells));

/** Every case, its recorded output beside the input it was produced from. */
export async function buildForecastCorpus(): Promise<CorpusFiles> {
  // The 3.x forecast modules import the server env through their logger; the pure functions read none of it.
  process.env.SKIP_ENV_VALIDATION ??= "1";
  const { cosAoi, sunPosition } = await import("../../apps/server/src/forecast/solar-geometry");
  const { pvPowerW } = await import("../../apps/server/src/forecast/pv-model");
  const { buildSolarForecast, toForecastExport } =
    await import("../../apps/server/src/forecast/solar-forecast");

  const rows: unknown[] = [];
  for (const c of GEOMETRY) {
    const { latitude, longitude, atMs, planes } = c.input;
    const sun = sunPosition(latitude, longitude, atMs);
    rows.push({ ...c, output: { sun, cosAoi: planes.map((p) => cosAoi(sun, p.tilt, p.azimuth)) } });
  }
  for (const c of POWER) {
    const { sample, kwp, tempCoefficient, systemLoss } = c.input;
    rows.push({ ...c, output: { watts: pvPowerW(sample, kwp, tempCoefficient, systemLoss) } });
  }
  for (const c of FORECAST) {
    const { config, data, provider, timeZone, nowMs, sim, correction } = c.input;
    const built = buildSolarForecast(
      config,
      data,
      provider,
      timeZone,
      nowMs,
      sim,
      correction && correctionModel(correction),
    );
    rows.push({
      ...c,
      output: { raw: toForecastExport(built, "raw"), usable: toForecastExport(built, "usable") },
    });
  }
  return { "forecast.ndjson": ndjson(rows) };
}
