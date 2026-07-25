/**
 * Learned PV-forecast bias correction — the pure model ("site adaptation" / MOS).
 *
 * The physics forecast in {@link ./solar-forecast} can't see site-specific
 * systematic bias (horizon shading, soiling, snow, degradation, a wrong
 * `systemLoss`). That bias is *repeatable*, so it is learned as a multiplicative
 * grid keyed by `(month, local hour-of-day)`: each cell holds an
 * exponentially-weighted mean of `actual / model-expected`, where "expected" is
 * the same PV model run on *reanalysis* irradiance. Running the model on true
 * (past) weather strips out the provider's cloud-prediction error — irreducible
 * noise you can't learn — leaving only the correctable site residual.
 *
 * Pure and DB/env-free (mirrors the split in {@link ./solar-forecast}), so the
 * math is unit-testable in isolation; the DB persistence lives in
 * {@link @SunReye/db/forecast-correction} and the orchestration in
 * {@link ./forecast-correction-job}.
 */

/** One learned grid cell: the decayed mean ratio and its effective sample count. */
export interface CorrectionCell {
  /** EWMA of observed `actual / expected`. */
  ratio: number;
  /** Effective sample count behind `ratio` (saturates at ~`1 / (1 - decay)`). */
  weight: number;
}

/** Per-inverter skill accounting: decayed mean absolute error, with and without correction. */
export interface SkillStats {
  /** Decayed mean |expected − actual|, W (no correction). */
  maeRaw: number;
  /** Decayed mean |expected·factor − actual|, W (correction applied). */
  maeCorrected: number;
  /** Effective sample count behind the two means. */
  samples: number;
}

/** The learned grid, keyed by {@link cellKey}. Empty ⇒ every factor is 1 (no-op). */
export type CorrectionModel = Map<string, CorrectionCell>;

/** One matched hour: the model's expectation on true weather vs the measured average. */
export interface Observation {
  /** Slot start in the plant's local time, `YYYY-MM-DDTHH:mm`. */
  localTime: string;
  /** Model-expected average AC power over the hour, given reanalysis weather, W. */
  expectedW: number;
  /** Measured average AC power over the same hour, W. */
  actualW: number;
}

// --- Tunables (deliberately not user-config: this is model behaviour) --------

/**
 * Forgetting horizon, in observations. Each `(month, hour)` cell sees ~one
 * observation per day it is learned, so this is ~30 days of half-life: soiling
 * clears, snow melts, and degradation drifts in, while single-day noise averages
 * out. Drives the EWMA decay {@link DECAY}.
 */
const HALF_LIFE_OBS = 30;
const DECAY = 2 ** (-1 / HALF_LIFE_OBS);

/**
 * Shrinkage strength. The applied factor pulls the cell's raw mean toward 1.0 by
 * `weight / (weight + SHRINKAGE_K)`, so a cell needs several observations before
 * it moves the forecast much — a couple of stray hours can't swing it.
 */
const SHRINKAGE_K = 5;

/** Hard bounds on the applied factor — a learned nudge, never an override. */
const FACTOR_MIN = 0.6;
const FACTOR_MAX = 1.4;

/**
 * A single observation's ratio is clamped to this window before folding, so a
 * sensor glitch or a stray near-zero can't drag a cell to an absurd place.
 */
const RATIO_OBS_MIN = 0.2;
const RATIO_OBS_MAX = 2.5;

/**
 * Fraction of nameplate below which an hour is too dim to learn from — dawn/dusk
 * ratios explode near zero and carry no site signal.
 */
const EXPECTED_FLOOR_FRAC = 0.03;

/**
 * Fraction of nameplate above which an hour is dropped as likely **curtailed**
 * (feed-in cap or full battery): production is limited by the plant, not the
 * model, so learning from it would mislabel clipping as model over-prediction.
 */
const SATURATION_FRAC = 0.85;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Grid key for a `(month 1–12, hour 0–23)` cell. */
export const cellKey = (month: number, hour: number): string => `${month}:${hour}`;

/** Local calendar month (1–12) of a `YYYY-MM-DDTHH:mm` plant-local timestamp. */
export const monthOf = (localTime: string): number => Number(localTime.slice(5, 7));

/** Local hour-of-day (0–23) of a `YYYY-MM-DDTHH:mm` plant-local timestamp. */
export const hourOf = (localTime: string): number => Number(localTime.slice(11, 13));

/**
 * The multiplier to apply for a `(month, hour)` slot: the cell's decayed mean
 * ratio, shrunk toward 1.0 by its confidence and clamped to the safe band.
 * Unknown cells (never learned) return 1 — the forecast passes through untouched.
 */
export function correctionFactor(model: CorrectionModel, month: number, hour: number): number {
  const cell = model.get(cellKey(month, hour));
  if (!cell) return 1;
  const shrunk = 1 + (cell.ratio - 1) * (cell.weight / (cell.weight + SHRINKAGE_K));
  return clamp(shrunk, FACTOR_MIN, FACTOR_MAX);
}

/** Fold one observed ratio into a cell as a decayed weighted mean. */
function foldRatio(cell: CorrectionCell | undefined, ratioObs: number): CorrectionCell {
  const w0 = cell ? cell.weight * DECAY : 0;
  const prev = cell?.ratio ?? 0;
  return { ratio: (w0 * prev + ratioObs) / (w0 + 1), weight: w0 + 1 };
}

/** Fold one absolute error pair into the decayed skill means. */
function foldSkill(skill: SkillStats, errRaw: number, errCorrected: number): SkillStats {
  const w0 = skill.samples * DECAY;
  return {
    maeRaw: (w0 * skill.maeRaw + errRaw) / (w0 + 1),
    maeCorrected: (w0 * skill.maeCorrected + errCorrected) / (w0 + 1),
    samples: w0 + 1,
  };
}

/** Outcome of folding a batch of observations into the model + skill stats. */
export interface LearnResult {
  /** Keys of the cells whose values changed — the caller persists just these. */
  touched: Set<string>;
  /** Updated skill stats after the batch. */
  skill: SkillStats;
}

/**
 * Fold a chronological batch of observations into `model` (mutated in place) and
 * `skill` (returned anew). Observations that are too dim or likely curtailed are
 * skipped. The correction's skill is measured **out-of-sample**: each hour's
 * corrected error uses the factor as it stood *before* that hour updated the cell.
 *
 * `nameplateW` is the plant's total DC nameplate (Σ kWp × 1000), the reference
 * for the dim/curtailed fractions.
 */
export function learn(
  model: CorrectionModel,
  skill: SkillStats,
  observations: readonly Observation[],
  nameplateW: number,
): LearnResult {
  const floor = Math.max(1, nameplateW * EXPECTED_FLOOR_FRAC);
  const ceiling = nameplateW * SATURATION_FRAC;
  const touched = new Set<string>();
  let nextSkill = skill;

  for (const obs of observations) {
    if (!(obs.expectedW >= floor) || obs.actualW < 0) continue;
    if (obs.expectedW >= ceiling || obs.actualW >= ceiling) continue;

    const month = monthOf(obs.localTime);
    const hour = hourOf(obs.localTime);
    // Skill uses the pre-update factor so the number reflects prediction, not fit.
    const factor = correctionFactor(model, month, hour);
    nextSkill = foldSkill(
      nextSkill,
      Math.abs(obs.expectedW - obs.actualW),
      Math.abs(obs.expectedW * factor - obs.actualW),
    );

    const ratioObs = clamp(obs.actualW / obs.expectedW, RATIO_OBS_MIN, RATIO_OBS_MAX);
    const key = cellKey(month, hour);
    model.set(key, foldRatio(model.get(key), ratioObs));
    touched.add(key);
  }

  return { touched, skill: nextSkill };
}

/** Percentage reduction in mean absolute error from the correction (0 when no data). */
export function skillImprovementPct(skill: SkillStats): number {
  if (skill.samples <= 0 || skill.maeRaw <= 0) return 0;
  return ((skill.maeRaw - skill.maeCorrected) / skill.maeRaw) * 100;
}
