import { describe, expect, test } from "bun:test";
import { type EvPullInInputs, PULL_IN_MODE, planEvPullIn } from "./ev-pull-in";
import type { EvccLoadpoint, EvccState } from "./evcc";

const loadpoint = (over: Partial<EvccLoadpoint> = {}): EvccLoadpoint =>
  ({
    index: 0,
    title: "Garage",
    mode: "pv",
    connected: true,
    charging: false,
    vehicleSoc: 40,
    effectiveLimitSoc: 80,
    ...over,
  }) as EvccLoadpoint;

const state = (loadpoints: EvccLoadpoint[], reachable = true): EvccState =>
  ({ reachable, loadpoints, subtractFromHome: false }) as EvccState;

const inputs = (over: Partial<EvPullInInputs> = {}): EvPullInInputs => ({
  enabled: true,
  regime: "absorb",
  evcc: state([loadpoint()]),
  heldLoadpoints: [],
  ...over,
});

describe("planEvPullIn", () => {
  test("claims a connected car that still wants energy", () => {
    const plan = planEvPullIn(inputs());
    expect(plan.claim).toEqual([{ loadpoint: 0, previousMode: "pv" }]);
    expect(plan.release).toEqual([]);
  });

  test("does nothing at all while switched off", () => {
    expect(planEvPullIn(inputs({ enabled: false })).claim).toEqual([]);
  });

  test("only acts in the regimes where a sink is actually wanted", () => {
    // `pre-shape` is the envelope coping on its own; overriding the user's charge
    // plan to solve a problem that isn't happening would be a bad trade.
    expect(planEvPullIn(inputs({ regime: "absorb" })).claim).toHaveLength(1);
    expect(planEvPullIn(inputs({ regime: "spend-down" })).claim).toHaveLength(1);
    expect(planEvPullIn(inputs({ regime: "pre-shape" })).claim).toEqual([]);
    expect(planEvPullIn(inputs({ regime: "waiting" })).claim).toEqual([]);
    expect(planEvPullIn(inputs({ regime: "none" })).claim).toEqual([]);
  });

  test("skips a car that is unplugged or already at its limit", () => {
    expect(planEvPullIn(inputs({ evcc: state([loadpoint({ connected: false })]) })).claim).toEqual(
      [],
    );
    expect(
      planEvPullIn(inputs({ evcc: state([loadpoint({ vehicleSoc: 80, effectiveLimitSoc: 80 })]) }))
        .claim,
    ).toEqual([]);
  });

  test("an unknown SOC still claims — the worst case costs nothing", () => {
    // EVCC simply declines to charge a car that doesn't want energy, so guessing
    // "yes" is free while guessing "no" throws away the sink.
    const plan = planEvPullIn(inputs({ evcc: state([loadpoint({ vehicleSoc: null })]) }));
    expect(plan.claim).toHaveLength(1);
  });

  test("claiming is idempotent — a held loadpoint keeps the user's remembered mode", () => {
    // Re-claiming would overwrite the snapshot with our own `now` and the car
    // would never get its original mode back.
    const plan = planEvPullIn(inputs({ heldLoadpoints: [0] }));
    expect(plan.claim).toEqual([]);
    expect(plan.release).toEqual([]);
  });

  test("hands back everything held once the window is over", () => {
    const plan = planEvPullIn(inputs({ regime: "waiting", heldLoadpoints: [0, 1] }));
    expect(plan.release).toEqual([0, 1]);
  });

  test("hands back a car that was unplugged mid-window", () => {
    const plan = planEvPullIn(
      inputs({ evcc: state([loadpoint({ connected: false })]), heldLoadpoints: [0] }),
    );
    expect(plan.release).toEqual([0]);
  });

  test("hands back when EVCC goes unreachable, rather than forgetting the claim", () => {
    const plan = planEvPullIn(inputs({ evcc: state([loadpoint()], false), heldLoadpoints: [0] }));
    expect(plan.release).toEqual([0]);
  });

  test("a loadpoint with no reported mode degrades to handing back `off`", () => {
    const plan = planEvPullIn(inputs({ evcc: state([loadpoint({ mode: null })]) }));
    expect(plan.claim).toEqual([{ loadpoint: 0, previousMode: "off" }]);
  });

  test("the mode we set is EVCC's immediate-charge mode", () => {
    expect(PULL_IN_MODE).toBe("now");
  });
});
