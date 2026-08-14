/**
 * EV charge-power estimator — fills the gap between EVCC's slow publish
 * cadence (10–30 s loop) and the inverter's 1 Hz house-load feed, so the
 * dashboard's charger node moves in near-real-time.
 *
 * Three inputs, one live estimate per loadpoint:
 *
 * - **anchor** — EVCC's own `chargePower` publish. Ground truth: the estimate
 *   snaps to it and the house-load baseline is recomputed, so the estimator
 *   can never drift for longer than one EVCC interval.
 * - **feed-forward** — `mode/set` commands observed on the broker (SunReye's
 *   own writes echo back too). The expected power is known before EVCC's next
 *   tick confirms it, so the estimate jumps immediately; it is confirmed by
 *   the load actually moving there, or reverted on deadline.
 * - **residual** — each 1 Hz house-load sample. A step that quantizes to a
 *   plausible charger delta (whole amps × 230 V × active phases) is attributed
 *   to the charger; everything else is absorbed into the house baseline.
 *
 * Residual attribution is inherently ambiguous (a 3-phase 3 A step and a 2 kW
 * kettle look alike), so it is hedged three ways: steps are rate-limited (EVCC
 * adjusts at most once per loop), in `now` mode only downward steps count (the
 * current is pinned at max, so an upward step must be the house), and every
 * EVCC tick re-anchors to truth.
 *
 * Pure state machine: no I/O, no timers. Callers feed events and read
 * estimates; the clock is injected for tests.
 */

/** Where the current `watts` figure comes from (freshness/confidence hint). */
export type ChargePowerSource = "measured" | "estimated" | "feedforward";

export interface LiveChargePower {
  watts: number;
  source: ChargePowerSource;
}

/** Loadpoint facts mirrored from EVCC's state topics, fed via updateParams. */
export interface LoadpointParams {
  charging: boolean;
  connected: boolean;
  /** Charge mode `off` | `pv` | `minpv` | `now`; null until published. */
  mode: string | null;
  phasesActive: number | null;
  /** Effective max charge current (A); null until published. */
  maxCurrentA: number | null;
}

interface LoadpointState {
  params: LoadpointParams;
  /** Current best estimate (W). */
  estimate: number;
  source: ChargePowerSource;
  /** Last EVCC-reported chargePower — the revert target for failed predictions. */
  anchorPower: number;
  /** Wall-clock of the last residual step attributed to this loadpoint. */
  lastStepAt: number;
  /** Outstanding feed-forward prediction awaiting confirmation. */
  pending: { expectW: number; deadline: number } | null;
}

const VOLTS = 230;
/** Load deltas below this are meter noise; silently absorbed into the baseline. */
const NOISE_W = 150;
/** Relative tolerance when snapping a delta to a whole-amp charger step
 * (covers grid-voltage swing, which scales with the current)… */
const SNAP_TOLERANCE = 0.1;
/** …capped in absolute amps, or large single-phase deltas would all "snap"
 * (at 8 A a ±10% window is ±0.8 A — wider than the 1 A grid itself). */
const SNAP_TOLERANCE_MAX_A = 0.4;
/** Min gap between attributed steps — EVCC adjusts at most once per loop. */
const MIN_STEP_GAP_MS = 3000;
const DEFAULT_MAX_CURRENT_A = 16;
/** Feed-forward predictions unconfirmed past this revert to the last anchor
 * (2.5× a worst-case 30 s EVCC interval, so a real anchor always wins first). */
const FEEDFORWARD_TIMEOUT_MS = 75_000;
/** Load must land this close to the predicted level to confirm a feed-forward. */
const CONFIRM_TOLERANCE_W = 300;
/** Clamp headroom over the theoretical phase/current maximum. */
const CLAMP_HEADROOM = 1.1;

const defaultParams = (): LoadpointParams => ({
  charging: false,
  connected: false,
  mode: null,
  phasesActive: null,
  maxCurrentA: null,
});

/** Does `deltaW` quantize to a whole-amp step at 230 V on `phases` phases? */
function snapsToChargerStep(deltaW: number, phases: number, maxA: number): boolean {
  const amps = Math.abs(deltaW) / (VOLTS * phases);
  const nearest = Math.round(amps);
  if (nearest < 1 || nearest > maxA) return false;
  return Math.abs(amps - nearest) <= Math.min(nearest * SNAP_TOLERANCE, SNAP_TOLERANCE_MAX_A);
}

export interface EvPowerEstimator {
  /** EVCC published `chargePower` — snap to truth. Returns whether output changed. */
  anchorPower(index: number, watts: number): boolean;
  /** Mirror a loadpoint state topic into the params (never changes output). */
  updateParams(index: number, params: Partial<LoadpointParams>): void;
  /**
   * A `<key>/set` command was observed. Only `mode` yields a prediction
   * (`off` → 0 W, `now` → phases × 230 V × max current); `pv`/`minpv` ramp
   * gradually and are left to the residual tracker. Returns whether output
   * changed — callers should push immediately when it did.
   */
  feedForward(index: number, key: string, value: string): boolean;
  /**
   * Feed one house-load sample (W, or null when the metric is unavailable).
   * Resolves pending predictions, then attributes or absorbs the residual.
   * Returns whether any loadpoint's output changed.
   */
  onLoadSample(loadW: number | null): boolean;
  /** Live estimate for a loadpoint; null when it was never anchored/observed. */
  live(index: number): LiveChargePower | null;
  reset(): void;
}

export function createEvPowerEstimator(nowFn: () => number = () => Date.now()): EvPowerEstimator {
  const lps = new Map<number, LoadpointState>();
  /** House load minus all charger estimates; null until a load sample arrives. */
  let baseline: number | null = null;
  let lastLoadW: number | null = null;

  function getOrCreate(index: number): LoadpointState {
    let lp = lps.get(index);
    if (!lp) {
      lp = {
        params: defaultParams(),
        estimate: 0,
        source: "measured",
        anchorPower: 0,
        lastStepAt: 0,
        pending: null,
      };
      lps.set(index, lp);
    }
    return lp;
  }

  const total = (): number => [...lps.values()].reduce((sum, lp) => sum + lp.estimate, 0);

  const maxWatts = (lp: LoadpointState): number =>
    (lp.params.phasesActive ?? 3) *
    VOLTS *
    (lp.params.maxCurrentA ?? DEFAULT_MAX_CURRENT_A) *
    CLAMP_HEADROOM;

  function anchorPower(index: number, watts: number): boolean {
    const lp = getOrCreate(index);
    const changed = lp.estimate !== watts || lp.source !== "measured" || lp.pending !== null;
    lp.anchorPower = watts;
    lp.estimate = watts;
    lp.source = "measured";
    lp.pending = null;
    // Rebase on the freshest load sample (≤1 poll old — close enough; the next
    // sample's residual lands under NOISE_W and is absorbed).
    baseline = lastLoadW !== null ? lastLoadW - total() : null;
    return changed;
  }

  function updateParams(index: number, params: Partial<LoadpointParams>): void {
    Object.assign(getOrCreate(index).params, params);
  }

  /**
   * The power a `mode` command implies, or null when it implies nothing:
   * `pv`/`minpv` ramp gradually (the residual tracker's job), and `now` without
   * the vehicle or phase facts would be a wild max-power guess — skip it and
   * let the next anchor catch up.
   */
  function expectedWattsForMode(lp: LoadpointState, mode: string): number | null {
    if (mode === "off") return 0;
    if (mode !== "now") return null;
    if (!lp.params.connected || lp.params.phasesActive === null) return null;
    return lp.params.phasesActive * VOLTS * (lp.params.maxCurrentA ?? DEFAULT_MAX_CURRENT_A);
  }

  /** Already sitting at the target with nothing in flight → nothing to predict. */
  const settledAt = (lp: LoadpointState, expectW: number): boolean =>
    lp.estimate === expectW && lp.pending === null && lp.source === "measured";

  function feedForward(index: number, key: string, value: string): boolean {
    if (key !== "mode") return false;
    const lp = getOrCreate(index);
    const expectW = expectedWattsForMode(lp, value);
    if (expectW === null || settledAt(lp, expectW)) return false;
    const changed = lp.estimate !== expectW || lp.source !== "feedforward";
    lp.pending = { expectW, deadline: nowFn() + FEEDFORWARD_TIMEOUT_MS };
    lp.estimate = expectW;
    lp.source = "feedforward";
    return changed;
  }

  /** Can this residual step plausibly be the charger adjusting? */
  function attributable(lp: LoadpointState, deltaW: number, now: number): boolean {
    if (now - lp.lastStepAt < MIN_STEP_GAP_MS) return false;
    // In `now` mode the current is pinned at max: upward steps must be the
    // house; downward ones can be the car tapering or dropping phases.
    if (lp.params.mode === "now" && deltaW > 0) return false;
    const maxA = lp.params.maxCurrentA ?? DEFAULT_MAX_CURRENT_A;
    const candidates = lp.params.phasesActive !== null ? [lp.params.phasesActive] : [1, 3];
    return candidates.some((phases) => snapsToChargerStep(deltaW, phases, maxA));
  }

  /** The pending prediction came true: the load reached the predicted level. */
  function confirmPending(lp: LoadpointState): boolean {
    lp.pending = null;
    const source: ChargePowerSource = lp.estimate === lp.anchorPower ? "measured" : "estimated";
    const changed = lp.source !== source;
    lp.source = source;
    return changed;
  }

  /** The prediction never materialized — fall back to the last EVCC anchor. */
  function revertPending(lp: LoadpointState): boolean {
    lp.pending = null;
    const changed = lp.estimate !== lp.anchorPower || lp.source !== "measured";
    lp.estimate = lp.anchorPower;
    lp.source = "measured";
    return changed;
  }

  /**
   * Resolve pending feed-forwards: confirmed once the load reaches the
   * predicted level, reverted to the last anchor when the deadline passes.
   * Returns whether any loadpoint's output changed.
   */
  function resolvePending(loadW: number, now: number): boolean {
    let changed = false;
    for (const lp of lps.values()) {
      if (!lp.pending) continue;
      const confirmed =
        baseline !== null && Math.abs(loadW - (baseline + total())) <= CONFIRM_TOLERANCE_W;
      if (confirmed) changed = confirmPending(lp) || changed;
      else if (now >= lp.pending.deadline) changed = revertPending(lp) || changed;
    }
    return changed;
  }

  /**
   * Attribute a load step to the single charging loadpoint, or absorb it into
   * the house baseline. Returns whether an estimate changed.
   */
  function applyResidual(delta: number, now: number): boolean {
    // Attribution needs an unambiguous owner: exactly one charging loadpoint.
    const charging = [...lps.values()].filter((lp) => lp.params.charging);
    const lp = charging.length === 1 ? charging[0] : undefined;
    if (lp && attributable(lp, delta, now)) {
      lp.estimate = Math.min(Math.max(lp.estimate + delta, 0), maxWatts(lp));
      lp.source = "estimated";
      lp.lastStepAt = now;
      return true;
    }
    baseline = (baseline ?? 0) + delta; // house appliance (kettle, oven, …)
    return false;
  }

  function onLoadSample(loadW: number | null): boolean {
    if (loadW === null) {
      baseline = null;
      lastLoadW = null;
      return false;
    }
    const now = nowFn();
    lastLoadW = loadW;
    const changed = resolvePending(loadW, now);

    if (baseline === null) {
      baseline = loadW - total();
      return changed;
    }
    // A prediction is still in flight: the load is mid-transition, so residuals
    // are meaningless — hold the baseline until it settles or reverts.
    if ([...lps.values()].some((lp) => lp.pending !== null)) return changed;

    const delta = loadW - (baseline + total());
    if (Math.abs(delta) < NOISE_W) {
      baseline += delta; // meter noise / slow house drift — keep the baseline glued
      return changed;
    }
    return applyResidual(delta, now) || changed;
  }

  function live(index: number): LiveChargePower | null {
    const lp = lps.get(index);
    return lp ? { watts: Math.round(lp.estimate), source: lp.source } : null;
  }

  function reset(): void {
    lps.clear();
    baseline = null;
    lastLoadW = null;
  }

  return { anchorPower, updateParams, feedForward, onLoadSample, live, reset };
}
