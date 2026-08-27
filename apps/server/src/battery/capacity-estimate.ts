/**
 * Usable battery capacity, and state of health, inferred from what the pack
 * actually reports.
 *
 * Neither Deye family exposes a capacity, an SOH or a cycle count — the only
 * battery signals are SOC, power, voltage and temperature. So capacity is
 * derived: over a stretch where the pack only discharged, the energy that came
 * out divided by the fraction of charge it cost is the pack's full-range energy.
 *
 * The division is trivial. Everything here is about which stretches are allowed
 * into it, because each input is imperfect in a specific, known way:
 *
 *   * **SOC is quantised to 1 %.** A 5-point drop carries +/-20 % on the
 *     denominator, so a shallow stretch is mostly rounding — hence
 *     {@link MIN_DELTA_SOC}.
 *   * **SOC is a BMS estimate, not a measurement**, and the BMS recalibrates it
 *     near full and empty: it can sit pinned at 100 while energy flows, or jump
 *     several points at once. The relationship this measures does not hold
 *     there — hence {@link TRUSTED_SOC}.
 *   * **Energy equals the integral only while nothing charges the pack.** Any
 *     charge mid-stretch breaks the segment rather than netting off.
 *   * **A gap in the data is unmeasured energy.** Bridging one would credit a
 *     real SOC drop to whatever little was recorded, and read as a tiny pack.
 *
 * What survives those rules is still noisy, so {@link estimateCapacity} takes a
 * median of per-segment slopes rather than a mean: one recalibration event that
 * halves an apparent energy drags a mean by several percent and this by nothing.
 *
 * The integral is exact rather than approximate. A stored row is an interval
 * carrying its own `dur_ms` (#117), so `sum(w * dur)` is the true energy, not a
 * Riemann sum over samples — which is also why nothing here counts rows.
 *
 * Pure: no database, no clock. The DB-bound half lives in `./health.ts`.
 */

/** One SOC reading, as a percentage, at an instant. */
export interface SocSample {
  /** Epoch milliseconds. */
  t: number;
  /** 0..100. */
  soc: number;
}

/**
 * One held value and how long it was held — the shape a change-only row has.
 * `w` is watts for power (positive = discharge) and °C for temperature; the
 * integration is the same either way.
 */
export interface PowerInterval {
  t: number;
  durMs: number;
  w: number;
}

/** A stretch over which the pack only discharged, deep enough to measure. */
export interface DischargeSegment {
  startMs: number;
  endMs: number;
  socStart: number;
  socEnd: number;
  /** `socStart - socEnd`, always positive. */
  deltaSoc: number;
  /** Energy out over the segment, kWh. */
  energyKwh: number;
  /** Mean pack temperature over the segment, when temperature was supplied. */
  meanTempC?: number;
}

/**
 * The shallowest segment worth using, in SOC points.
 *
 * SOC is quantised to 1 %, so the denominator carries +/-1 point however deep
 * the segment is. At 20 points that is +/-5 %; at 5 points it is +/-20 %, which
 * is not a measurement of anything.
 */
// fallow-ignore-next-line unused-export -- exported so the tests can assert the gate is at least this strict rather than restating the number; test files are not traced as consumers.
export const MIN_DELTA_SOC = 20;

/**
 * The SOC band where the BMS's own estimate is trustworthy.
 *
 * Outside it the BMS recalibrates: SOC moves without energy moving, or energy
 * moves without SOC. Segments are clipped to this band rather than discarded, so
 * a full 100 → 5 discharge still yields its trustworthy middle.
 */
const TRUSTED_SOC = { min: 10, max: 95 } as const;

/** Longer than this between readings and the segment breaks. */
const MAX_GAP_MS = 15 * 60_000;

/**
 * The widest SOC step {@link dischargeSign} will still pair with a mean power.
 *
 * Deliberately far looser than {@link MAX_GAP_MS}, which bounds how much
 * UNMEASURED energy a segment may contain. Sign inference has no such exposure —
 * it reads only the direction of the duration-weighted mean — and the tight
 * bound would blind it exactly where the question is hardest: at low power a
 * single 1 % step legitimately takes over an hour, so a 15-minute rule would
 * discard every reading from a quiet pack.
 */
const SIGN_MAX_GAP_MS = 6 * 3_600_000;

/** Below this many watts the pack is idle rather than discharging. */
const IDLE_W = 5;

/**
 * Fewest segments before a capacity is reported.
 *
 * One segment is an anecdote: it carries the SOC quantisation, whatever the
 * temperature was that night, and whatever the BMS believed. The median needs
 * enough of them that a single bad one cannot be the middle.
 */
// fallow-ignore-next-line unused-export -- exported so the tests can assert the gate is at least this strict rather than restating the number; test files are not traced as consumers.
export const MIN_SEGMENTS = 5;

/** Energy of one interval, in kWh. */
const intervalKwh = (i: PowerInterval): number => (i.w * i.durMs) / 3_600_000_000;

/** Duration-weighted mean of a set of intervals overlapping `[from, to)`. */
function weightedMean(
  intervals: readonly PowerInterval[],
  from: number,
  to: number,
): number | null {
  let sum = 0;
  let weight = 0;
  for (const i of intervals) {
    const overlap = Math.min(i.t + i.durMs, to) - Math.max(i.t, from);
    if (overlap <= 0) continue;
    sum += i.w * overlap;
    weight += overlap;
  }
  return weight > 0 ? sum / weight : null;
}

/** Total discharge energy over `[from, to)`, kWh, clipping partial intervals. */
function energyBetween(intervals: readonly PowerInterval[], from: number, to: number): number {
  let kwh = 0;
  for (const i of intervals) {
    const overlap = Math.min(i.t + i.durMs, to) - Math.max(i.t, from);
    if (overlap <= 0) continue;
    kwh += intervalKwh({ t: i.t, durMs: overlap, w: i.w });
  }
  return kwh;
}

/** True while the pack is charging at any point inside `[from, to)`. */
function charged(intervals: readonly PowerInterval[], from: number, to: number): boolean {
  return intervals.some(
    (i) => i.w < -IDLE_W && Math.min(i.t + i.durMs, to) - Math.max(i.t, from) > 0,
  );
}

/** Whether two consecutive SOC readings can belong to the same segment. */
function continues(prev: SocSample, next: SocSample, power: readonly PowerInterval[]): boolean {
  if (next.t - prev.t > MAX_GAP_MS) return false;
  if (next.soc > prev.soc) return false;
  return !charged(power, prev.t, next.t);
}

/**
 * Split a SOC series into the discharge stretches worth measuring.
 *
 * Readings outside {@link TRUSTED_SOC} are dropped before splitting rather than
 * ending a segment, so a discharge that starts at 100 % contributes its
 * trustworthy part instead of nothing — but the drop still breaks the run
 * wherever it leaves a gap longer than {@link MAX_GAP_MS}.
 */
export function dischargeSegments(
  soc: readonly SocSample[],
  power: readonly PowerInterval[],
  opts: { temperature?: readonly PowerInterval[] } = {},
): DischargeSegment[] {
  const usable = [...soc]
    .sort((a, b) => a.t - b.t)
    .filter((s) => s.soc >= TRUSTED_SOC.min && s.soc <= TRUSTED_SOC.max);

  const segments: DischargeSegment[] = [];
  let run: SocSample[] = [];

  const flush = () => {
    const first = run[0];
    const last = run.at(-1);
    if (first && last && first.soc - last.soc >= MIN_DELTA_SOC) {
      const energyKwh = energyBetween(power, first.t, last.t);
      const meanTempC = opts.temperature
        ? (weightedMean(opts.temperature, first.t, last.t) ?? undefined)
        : undefined;
      segments.push({
        startMs: first.t,
        endMs: last.t,
        socStart: first.soc,
        socEnd: last.soc,
        deltaSoc: first.soc - last.soc,
        energyKwh,
        ...(meanTempC === undefined ? {} : { meanTempC }),
      });
    }
    run = [];
  };

  for (const sample of usable) {
    const prev = run.at(-1);
    if (prev && !continues(prev, sample, power)) {
      flush();
    }
    run.push(sample);
  }
  flush();
  return segments;
}

/**
 * Which way `battery.power` points, inferred from the data rather than assumed.
 *
 * The role is declared `signed` and the repo does not agree with itself about
 * what the sign means: `automation/peak-shaving-engine.ts` reads `> 0` as
 * discharging (which is what the Deye families actually report), while
 * `packages/inverter-core/src/generic-sim.ts` documents `> 0` as charging. A
 * profile is free to map either. Getting it backwards here would not fail — it
 * would silently measure the charge side and report a capacity inflated by the
 * round-trip losses.
 *
 * So it is measured: pair each SOC change with the mean power over the same
 * span, and see which sign accompanies SOC falling. Returns `+1` when positive
 * power means discharging, `-1` when it means charging, and `null` when the data
 * does not say — no SOC movement, or no agreement — which the caller must treat
 * as "cannot measure" rather than picking a default.
 */
/**
 * One SOC step's vote: `+1` when the power over the step agrees with
 * "positive means discharge", `-1` when it contradicts it, `0` when the step
 * says nothing — no SOC movement, an idle pack, or too long a gap to pair.
 */
function signVote(prev: SocSample, next: SocSample, power: readonly PowerInterval[]): number {
  if (next.soc === prev.soc || next.t - prev.t > SIGN_MAX_GAP_MS) return 0;
  const mean = weightedMean(power, prev.t, next.t);
  if (mean === null || Math.abs(mean) <= IDLE_W) return 0;
  const positive = mean > 0 ? 1 : -1;
  // SOC fell: positive power agrees. SOC rose: positive power contradicts.
  return next.soc < prev.soc ? positive : -positive;
}

export function dischargeSign(
  soc: readonly SocSample[],
  power: readonly PowerInterval[],
): 1 | -1 | null {
  const ordered = [...soc].sort((a, b) => a.t - b.t);
  let vote = 0;
  for (let i = 1; i < ordered.length; i++) {
    vote += signVote(ordered[i - 1] as SocSample, ordered[i] as SocSample, power);
  }
  if (vote === 0) return null;
  return vote > 0 ? 1 : -1;
}

/** A capacity estimate and how much the segments behind it disagreed. */
export interface CapacityEstimate {
  /** Median full-range usable energy, kWh. */
  kwh: number;
  /** 10th and 90th percentile of the per-segment estimates. */
  low: number;
  high: number;
  /** How many segments the median was taken over. */
  segments: number;
}

/** Percentile of a sorted array, by nearest rank. */
function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index] as number;
}

/**
 * The pack's usable capacity, as the median of one estimate per segment.
 *
 * Every segment counts once, however deep it is. Depth is already a gate
 * ({@link MIN_DELTA_SOC}); weighting by it as well would let one long winter
 * night outvote a fortnight of ordinary ones.
 */
// fallow-ignore-next-line unused-export -- the estimator is the unit under test in capacity-estimate.test.ts; summariseEstimates is its only production caller.
export function estimateCapacity(segments: readonly DischargeSegment[]): CapacityEstimate | null {
  const perSegment = segments
    .filter((s) => s.deltaSoc > 0 && s.energyKwh > 0)
    .map((s) => s.energyKwh / (s.deltaSoc / 100))
    .sort((a, b) => a - b);
  if (perSegment.length < MIN_SEGMENTS) return null;
  return {
    kwh: percentile(perSegment, 0.5),
    low: percentile(perSegment, 0.1),
    high: percentile(perSegment, 0.9),
    segments: perSegment.length,
  };
}

/** What an SOH figure was measured against. */
export type HealthReference = "nameplate" | "baseline";

export interface StateOfHealth {
  /** Estimate / reference. Not capped: a pack above its nameplate is a real
   *  answer, and clamping would hide a nameplate entered wrong. */
  ratio: number;
  reference: HealthReference;
  referenceKwh: number;
}

/**
 * State of health against a nameplate when one is configured, and against this
 * install's own first solid estimate otherwise.
 *
 * The nameplate wins when both are known: the baseline is whatever this install
 * first measured, which is already degraded on a pack that was not new when
 * SunReye met it. With neither, the answer is null rather than 100 % — an
 * unmeasurable ratio must not read as a healthy one.
 */
// fallow-ignore-next-line unused-export -- unit under test in capacity-estimate.test.ts; summariseEstimates is its only production caller.
export function stateOfHealth(
  capacityKwh: number,
  against: { nameplateKwh?: number | null; baselineKwh?: number | null },
): StateOfHealth | null {
  const candidates: ReadonlyArray<[HealthReference, number | null | undefined]> = [
    ["nameplate", against.nameplateKwh],
    ["baseline", against.baselineKwh],
  ];
  for (const [reference, kwh] of candidates) {
    if (typeof kwh === "number" && kwh > 0) {
      return { ratio: capacityKwh / kwh, reference, referenceKwh: kwh };
    }
  }
  return null;
}

/** A stored per-segment estimate, as the summary consumes it. */
export interface StoredEstimate {
  measuredAtMs: number;
  segment: DischargeSegment;
}

export interface HealthSummary {
  /** Capacity over the recent window; null when too few segments. */
  capacity: CapacityEstimate | null;
  /** Capacity over this install's FIRST {@link MIN_SEGMENTS} segments. */
  baseline: CapacityEstimate | null;
  health: StateOfHealth | null;
}

/**
 * Turn stored per-segment estimates into a current capacity, a baseline and an
 * SOH.
 *
 * The baseline is the install's earliest solid measurement, and it is the MEDIAN
 * of the first {@link MIN_SEGMENTS} segments rather than the best of them. The
 * maximum of a noisy sample is biased upward and the median is not, so anchoring
 * on the highest early reading would make every later one look like degradation
 * that never happened.
 *
 * Estimates outside the recent window still count toward the baseline — they are
 * exactly what the baseline is for — which is why the two are filtered
 * differently rather than from one shared list.
 */
export function summariseEstimates(
  stored: readonly StoredEstimate[],
  opts: { nameplateKwh?: number | null; nowMs: number; recentWindowMs: number },
): HealthSummary {
  const ordered = [...stored].sort((a, b) => a.measuredAtMs - b.measuredAtMs);
  const since = opts.nowMs - opts.recentWindowMs;
  const capacity = estimateCapacity(
    ordered.filter((e) => e.measuredAtMs >= since).map((e) => e.segment),
  );
  const baseline = estimateCapacity(ordered.slice(0, MIN_SEGMENTS).map((e) => e.segment));
  return {
    capacity,
    baseline,
    health: capacity
      ? stateOfHealth(capacity.kwh, {
          nameplateKwh: opts.nameplateKwh ?? null,
          baselineKwh: baseline?.kwh ?? null,
        })
      : null,
  };
}
