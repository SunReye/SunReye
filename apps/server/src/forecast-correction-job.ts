/**
 * Learn job for the PV-forecast correction — the impure side of
 * {@link ./forecast-correction} (the pure math lives there; DB rows in
 * {@link @SunReye/db/forecast-correction}; the model loader in
 * {@link ./forecast-correction-store}).
 *
 * Once a day it folds newly-settled days into the grid: fetch *reanalysis*
 * irradiance for the un-learned window, run it through the same PV model
 * ({@link buildSolarForecast}'s uncurtailed `raw` view) to get the expected
 * output the real weather implied, line each hour up with the measured hourly
 * average ({@link queryHourlyAvgRange} of the `pv.total.power` metric), and hand
 * the matched pairs to {@link learn}. Reanalysis settles a few days late, so it
 * only ever asks for days older than {@link SETTLE_DAYS}; the first run backfills
 * a bounded window.
 *
 * Note on the compared quantity: `expected` is the forecast's own AC estimate
 * (configured `systemLoss` applied) and `actual` is the measured DC PV power.
 * The per-cell multiplier therefore absorbs any steady DC↔AC framing offset
 * together with the learnable site residual (shading, soiling, an over-pessimistic
 * `systemLoss`) — applying it aligns the forecast with what the plant actually
 * produces, which is exactly what the dashboard compares it against.
 */

import type { WeatherConfig } from "@SunReye/db/weather";
import { forecastReady } from "@SunReye/db/weather";
import {
  getCorrectionCells,
  getCorrectionState,
  upsertCorrectionCells,
  upsertCorrectionState,
} from "@SunReye/db/forecast-correction";
import {
  type CorrectionModel,
  type Observation,
  type SkillStats,
  cellKey,
  correctionFactor,
  learn,
  skillImprovementPct,
} from "./forecast-correction";
import { loadCorrectionModel } from "./forecast-correction-store";
import { getActiveProfileOrNull } from "./inverter";
import { queryHourlyAvgRange } from "./history";
import { type SolarForecastPoint, buildSolarForecast } from "./solar-forecast";
import { fetchHistoricalIrradiance } from "./solar-providers/open-meteo-archive";
import { liveState } from "./state";
import { log } from "./logging";

const logger = log("forecast-correction");

/** Days a reanalysis day must age before it's stable enough to learn from. */
const SETTLE_DAYS = 3;
/** How far back the first run reaches when there's no cursor yet. */
const BACKFILL_DAYS = 90;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const addDays = (date: string, n: number): string => isoDate(dayMs(date) + n * DAY_MS);

/** One grid cell for the settings panel: the applied factor + its confidence. */
export interface CorrectionCellView {
  month: number;
  hour: number;
  /** The multiplier actually applied for this slot (shrunk + clamped). */
  factor: number;
  /** Effective sample count behind the cell — drives the panel's opacity/confidence. */
  weight: number;
}

/** The `/api/forecast/correction` payload: state + learned grid + measured skill. */
export interface ForecastCorrectionView {
  /** Whether the correction is applied to the live forecast (config toggle). */
  enabled: boolean;
  /** Last local day folded into the grid, or null before the first run. */
  learnedThrough: string | null;
  skill: { maeRaw: number; maeCorrected: number; improvementPct: number; samples: number };
  cells: CorrectionCellView[];
}

/** The persisted correction row shape both the view and the learn run read. */
type CorrectionStateRow = Awaited<ReturnType<typeof getCorrectionState>>;

/** Measured skill carried on the state row (zeroed before the first run). */
const skillOf = (state: CorrectionStateRow): SkillStats => ({
  maeRaw: state?.maeRaw ?? 0,
  maeCorrected: state?.maeCorrected ?? 0,
  samples: state?.samples ?? 0,
});

/** Assemble the settings-panel view: the learned grid, applied factors, and skill. */
export async function getCorrectionView(config: WeatherConfig): Promise<ForecastCorrectionView> {
  const enabled = config.forecast.correction.enabled;
  const source = resolvePvSource();
  if (!source) {
    return {
      enabled,
      learnedThrough: null,
      skill: { ...skillOf(null), improvementPct: 0 },
      cells: [],
    };
  }

  const [rows, state] = await Promise.all([
    getCorrectionCells(source.inverterId),
    getCorrectionState(source.inverterId),
  ]);
  const model: CorrectionModel = new Map(
    rows.map((r) => [cellKey(r.month, r.hour), { ratio: r.ratio, weight: r.weight }]),
  );
  const skill = skillOf(state);
  return {
    enabled,
    learnedThrough: state?.learnedThrough ?? null,
    skill: { ...skill, improvementPct: skillImprovementPct(skill) },
    cells: rows.map((r) => ({
      month: r.month,
      hour: r.hour,
      factor: correctionFactor(model, r.month, r.hour),
      weight: r.weight,
    })),
  };
}

/** Which inverter id + `pv.total.power` metric key the correction is keyed to. */
function resolvePvSource(): { inverterId: string; pvKey: string } | null {
  const profile = getActiveProfileOrNull();
  if (!profile) return null;
  const pvKey = profile.metrics.find((m) => m.role === "pv.total.power")?.key;
  if (!pvKey) return null;
  return { inverterId: liveState.latest?.inverterId ?? profile.id, pvKey };
}

export interface LearnRunResult {
  /** Number of matched observations folded in this run. */
  learned: number;
  /** The last local day now folded into the grid, or null when nothing ran. */
  learnedThrough: string | null;
}

/** The settled, not-yet-learned `[start, end]` window, or null when nothing is due. */
function learnWindow(learnedThrough: string | null): { startDate: string; endDate: string } | null {
  const endDate = isoDate(Date.now() - SETTLE_DAYS * DAY_MS);
  const startDate = learnedThrough ? addDays(learnedThrough, 1) : addDays(endDate, -BACKFILL_DAYS);
  return startDate > endDate ? null : { startDate, endDate };
}

type ArchiveData = Awaited<ReturnType<typeof fetchHistoricalIrradiance>>;

/** Reanalysis irradiance for the window, or null when the archive call fails. */
async function fetchArchive(
  config: WeatherConfig & { latitude: number; longitude: number },
  startDate: string,
  endDate: string,
): Promise<ArchiveData | null> {
  try {
    return await fetchHistoricalIrradiance(
      { latitude: config.latitude, longitude: config.longitude },
      config.forecast.arrays.map(({ tilt, azimuth }) => ({ tilt, azimuth })),
      startDate,
      endDate,
    );
  } catch (err) {
    logger.warn("archive fetch failed ({start}…{end}): {error}", {
      start: startDate,
      end: endDate,
      error: err instanceof Error ? err.message : err,
    });
    return null;
  }
}

/**
 * Measured hourly PV averages spanning `expected`, keyed by UTC bucket instant
 * so a local-time forecast slot can be matched to them by instant.
 */
async function measuredByMs(
  source: { inverterId: string; pvKey: string },
  expected: SolarForecastPoint[],
  toUtcMs: (localTime: string) => number,
  fallbackTime: string,
): Promise<Map<number, number>> {
  const rows = await queryHourlyAvgRange(
    source.pvKey,
    source.inverterId,
    new Date(toUtcMs(expected[0]?.time ?? fallbackTime)),
    new Date(toUtcMs(expected.at(-1)?.time ?? fallbackTime) + HOUR_MS),
  );
  return new Map(rows.map((r) => [r.bucketMs, r.avg]));
}

/**
 * Matched `(expected, actual)` hours for the window: reanalysis run through the
 * uncurtailed PV model, lined up by UTC instant with the measured hourly average.
 * Returns `null` only when the archive fetch fails (so the caller retries without
 * advancing the cursor); an empty array is a successful "nothing to match".
 */
async function collectObservations(
  config: WeatherConfig & { latitude: number; longitude: number },
  source: { inverterId: string; pvKey: string },
  startDate: string,
  endDate: string,
): Promise<Observation[] | null> {
  const data = await fetchArchive(config, startDate, endDate);
  if (!data) return null; // fetch failed — the caller retries without advancing

  const expected = buildSolarForecast(config.forecast, data, "open-meteo-archive").raw.series;
  if (expected.length === 0) return [];

  const toUtcMs = (localTime: string): number =>
    Date.parse(`${localTime}:00Z`) - data.utcOffsetSeconds * 1000;
  const actualByMs = await measuredByMs(source, expected, toUtcMs, endDate);

  const observations: Observation[] = [];
  for (const point of expected) {
    const actual = actualByMs.get(toUtcMs(point.time));
    if (actual !== undefined) {
      observations.push({ localTime: point.time, expectedW: point.watts, actualW: actual });
    }
  }
  return observations;
}

/** Persist the cells the batch touched and advance the cursor + skill stats. */
async function persistLearned(
  inverterId: string,
  model: CorrectionModel,
  result: ReturnType<typeof learn>,
  learnedThrough: string,
): Promise<void> {
  await upsertCorrectionCells(
    [...result.touched].map((key) => {
      const cell = model.get(key);
      const [month, hour] = key.split(":").map(Number);
      return {
        inverterId,
        month: month ?? 0,
        hour: hour ?? 0,
        ratio: cell?.ratio ?? 1,
        weight: cell?.weight ?? 0,
      };
    }),
  );
  await upsertCorrectionState({
    inverterId,
    learnedThrough,
    maeRaw: result.skill.maeRaw,
    maeCorrected: result.skill.maeCorrected,
    samples: result.skill.samples,
  });
}

/**
 * Fold every settled, not-yet-learned day into the correction grid for the
 * active plant. Idempotent and cheap: no-ops when the forecast isn't configured,
 * the plant maps no total-PV metric, or there's nothing new to learn.
 */
export async function runForecastCorrectionLearn(config: WeatherConfig): Promise<LearnRunResult> {
  // `forecastReady` also narrows the config's location to non-null.
  if (!forecastReady(config)) return { learned: 0, learnedThrough: null };
  const source = resolvePvSource();
  if (!source) return { learned: 0, learnedThrough: null };

  const state = await getCorrectionState(source.inverterId);
  const unchanged = { learned: 0, learnedThrough: state?.learnedThrough ?? null };
  const window = learnWindow(state?.learnedThrough ?? null);
  if (!window) return unchanged;

  const observations = await collectObservations(config, source, window.startDate, window.endDate);
  if (observations === null) return unchanged; // fetch failed — retry next run
  if (observations.length === 0) {
    // No measured hour overlaps the window (fresh install, rollup lag, inverter
    // offline). Keep the cursor so those days are retried once history exists,
    // instead of being consumed with nothing learned.
    logger.info("no measured hours in {start}…{end} — cursor kept", {
      start: window.startDate,
      end: window.endDate,
    });
    return unchanged;
  }

  return await foldObservations(config, source.inverterId, state, observations, window.endDate);
}

/**
 * Fold matched observations into the grid and persist the result. Advances the
 * cursor only through the last day that actually had measured hours: a trailing
 * gap (rollups not settled yet, inverter down) is retried next run rather than
 * skipped forever.
 */
async function foldObservations(
  config: WeatherConfig,
  inverterId: string,
  state: CorrectionStateRow,
  observations: Observation[],
  windowEnd: string,
): Promise<LearnRunResult> {
  const model = await loadCorrectionModel(inverterId);
  const nameplateW = config.forecast.arrays.reduce((sum, a) => sum + a.kwp, 0) * 1000;
  const result = learn(
    model,
    skillOf(state),
    observations,
    nameplateW,
    config.forecast.maxOutputW ?? undefined,
  );

  const learnedThrough = observations.at(-1)?.localTime.slice(0, 10) ?? windowEnd;
  await persistLearned(inverterId, model, result, learnedThrough);
  logger.info("learned {n} hours through {end} ({cells} cells)", {
    n: observations.length,
    end: learnedThrough,
    cells: result.touched.size,
  });
  return { learned: observations.length, learnedThrough };
}
