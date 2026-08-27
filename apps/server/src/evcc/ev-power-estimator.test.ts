import { beforeEach, describe, expect, test } from "bun:test";
import { createEvPowerEstimator, type EvPowerEstimator } from "./ev-power-estimator";

/**
 * The estimator is a pure state machine with an injected clock, so every test
 * is a scripted event sequence: params + anchors + load samples in, estimates
 * out. Wattages use the charger's own arithmetic (amps × 230 V × phases) so
 * the numbers read as what they physically are.
 */

let now: number;
let est: EvPowerEstimator;

beforeEach(() => {
  // Start well past MIN_STEP_GAP_MS so the initial lastStepAt=0 doesn't
  // rate-limit the first attribution.
  now = 100_000;
  est = createEvPowerEstimator(() => now);
});

/** House baseline 500 W, charging 6 A on the given phases. */
function startCharging(phases: 1 | 3, mode = "pv"): number {
  const chargeW = 6 * 230 * phases;
  est.updateParams(1, {
    charging: true,
    connected: true,
    mode,
    phasesActive: phases,
    maxCurrentA: 16,
  });
  est.onLoadSample(500 + chargeW); // seeds lastLoadW for the anchor's rebase
  est.anchorPower(1, chargeW);
  return chargeW;
}

describe("anchor", () => {
  test("unknown loadpoint has no live estimate", () => {
    expect(est.live(1)).toBeNull();
  });

  test("chargePower publish is adopted verbatim as measured", () => {
    est.anchorPower(1, 4140);
    expect(est.live(1)).toEqual({ watts: 4140, source: "measured" });
  });

  test("re-anchor overrides any residual estimate", () => {
    const chargeW = startCharging(1);
    now += 4000;
    est.onLoadSample(500 + chargeW + 230); // +1 A step → estimated
    expect(est.live(1)?.source).toBe("estimated");
    est.anchorPower(1, chargeW + 230);
    expect(est.live(1)).toEqual({ watts: chargeW + 230, source: "measured" });
  });
});

describe("residual attribution", () => {
  test("a whole-amp step while charging moves the estimate", () => {
    const chargeW = startCharging(1); // 1380 W
    now += 4000;
    const changed = est.onLoadSample(500 + chargeW + 230); // +1 A @ 230 V, 1p
    expect(changed).toBe(true);
    expect(est.live(1)).toEqual({ watts: chargeW + 230, source: "estimated" });
  });

  test("a 3-phase step uses the phase-aware quantum", () => {
    const chargeW = startCharging(3); // 4140 W
    now += 4000;
    est.onLoadSample(500 + chargeW - 2 * 690); // −2 A × 3p = −1380 W
    expect(est.live(1)?.watts).toBe(chargeW - 1380);
  });

  test("sub-noise drift is absorbed into the baseline, not the charger", () => {
    const chargeW = startCharging(1);
    now += 4000;
    expect(est.onLoadSample(500 + chargeW + 100)).toBe(false);
    expect(est.live(1)?.watts).toBe(chargeW);
    // …and the absorbed drift doesn't come back as a phantom step later.
    now += 4000;
    expect(est.onLoadSample(500 + chargeW + 100)).toBe(false);
    expect(est.live(1)?.watts).toBe(chargeW);
  });

  test("a step that doesn't quantize to whole amps is the house", () => {
    const chargeW = startCharging(1);
    now += 4000;
    est.onLoadSample(500 + chargeW + 1035); // 4.5 A-equivalent: dead between steps
    expect(est.live(1)?.watts).toBe(chargeW);
  });

  test("upward steps in `now` mode are the house (current is pinned at max)", () => {
    const chargeW = startCharging(3, "now");
    now += 4000;
    est.onLoadSample(500 + chargeW + 2070); // kettle: quantizes to 3 A × 3p exactly
    expect(est.live(1)?.watts).toBe(chargeW);
  });

  test("downward steps in `now` mode still count (car taper / phase drop)", () => {
    const chargeW = startCharging(3, "now");
    now += 4000;
    est.onLoadSample(500 + chargeW - 690);
    expect(est.live(1)?.watts).toBe(chargeW - 690);
  });

  test("steps are rate-limited to one per EVCC adjustment cadence", () => {
    const chargeW = startCharging(1);
    now += 4000;
    est.onLoadSample(500 + chargeW + 230);
    now += 1000; // too soon — EVCC adjusts at most once per loop
    est.onLoadSample(500 + chargeW + 2 * 230);
    expect(est.live(1)?.watts).toBe(chargeW + 230);
  });

  test("no attribution while nothing charges", () => {
    est.updateParams(1, { charging: false, connected: true, mode: "pv", phasesActive: 1 });
    est.onLoadSample(500);
    est.anchorPower(1, 0);
    now += 4000;
    est.onLoadSample(500 + 230);
    expect(est.live(1)?.watts).toBe(0);
  });

  test("two simultaneously charging loadpoints → owner ambiguous, no attribution", () => {
    const chargeW = startCharging(3);
    est.updateParams(2, { charging: true, connected: true, mode: "pv", phasesActive: 3 });
    est.anchorPower(2, 4140);
    now += 4000;
    est.onLoadSample(500 + chargeW + 4140 + 690);
    expect(est.live(1)?.watts).toBe(chargeW);
    expect(est.live(2)?.watts).toBe(4140);
  });

  test("estimate clamps at the phase/current ceiling", () => {
    const chargeW = startCharging(1); // 16 A max → clamp ≈ 4048 W
    now += 4000;
    est.onLoadSample(500 + chargeW + 10 * 230);
    now += 4000;
    est.onLoadSample(500 + chargeW + 20 * 230); // second step would exceed 16 A
    expect(est.live(1)!.watts).toBeLessThanOrEqual(1 * 230 * 16 * 1.1);
  });

  test("a null load sample resets tracking without touching estimates", () => {
    const chargeW = startCharging(1);
    est.onLoadSample(null);
    expect(est.live(1)?.watts).toBe(chargeW);
    // Next sample only re-seeds the baseline — a changed level is not a step.
    now += 4000;
    est.onLoadSample(2500 + chargeW);
    expect(est.live(1)?.watts).toBe(chargeW);
  });
});

describe("feed-forward", () => {
  test("mode/set off predicts 0 W immediately", () => {
    const chargeW = startCharging(3);
    expect(est.feedForward(1, "mode", "off")).toBe(true);
    expect(est.live(1)).toEqual({ watts: 0, source: "feedforward" });
    // Load hasn't moved yet: the in-flight prediction must not spring back.
    est.onLoadSample(500 + chargeW);
    expect(est.live(1)?.watts).toBe(0);
    // Wallbox actually stops → prediction confirmed.
    now += 2000;
    est.onLoadSample(500);
    expect(est.live(1)).toEqual({ watts: 0, source: "estimated" });
  });

  test("mode/set now predicts phases × 230 V × max current", () => {
    est.updateParams(1, { connected: true, phasesActive: 3, maxCurrentA: 16 });
    est.onLoadSample(500);
    est.anchorPower(1, 0);
    expect(est.feedForward(1, "mode", "now")).toBe(true);
    expect(est.live(1)).toEqual({ watts: 3 * 230 * 16, source: "feedforward" });
  });

  test("unconfirmed prediction reverts to the last anchor on deadline", () => {
    const chargeW = startCharging(3);
    est.feedForward(1, "mode", "off");
    now += 76_000; // past FEEDFORWARD_TIMEOUT_MS, load never moved
    est.onLoadSample(500 + chargeW);
    expect(est.live(1)).toEqual({ watts: chargeW, source: "measured" });
  });

  test("an anchor always beats a pending prediction", () => {
    const chargeW = startCharging(3);
    est.feedForward(1, "mode", "off");
    est.anchorPower(1, chargeW); // EVCC's next tick: still charging
    expect(est.live(1)).toEqual({ watts: chargeW, source: "measured" });
  });

  test("`now` without phase facts makes no wild guess", () => {
    est.updateParams(1, { connected: true, phasesActive: null });
    expect(est.feedForward(1, "mode", "now")).toBe(false);
  });

  test("`now` while no vehicle is connected makes no prediction", () => {
    est.updateParams(1, { connected: false, phasesActive: 3 });
    expect(est.feedForward(1, "mode", "now")).toBe(false);
  });

  test("pv/minpv modes ramp — no jump prediction", () => {
    startCharging(3);
    expect(est.feedForward(1, "mode", "pv")).toBe(false);
    expect(est.feedForward(1, "mode", "minpv")).toBe(false);
  });

  test("non-mode commands are ignored", () => {
    startCharging(3);
    expect(est.feedForward(1, "limitSoc", "80")).toBe(false);
  });

  test("off while already at 0 and settled is a no-op", () => {
    est.onLoadSample(500);
    est.anchorPower(1, 0);
    expect(est.feedForward(1, "mode", "off")).toBe(false);
    expect(est.live(1)).toEqual({ watts: 0, source: "measured" });
  });
});

describe("reset", () => {
  test("clears every loadpoint", () => {
    startCharging(1);
    est.reset();
    expect(est.live(1)).toBeNull();
  });
});
