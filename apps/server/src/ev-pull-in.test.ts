import { describe, expect, test } from "bun:test";
import { BOOST_LIMIT_DISABLED, type EvPullInInputs, planEvPullIn } from "./ev-pull-in";

/** The mode an idle charger is woken into — EVCC's surplus-charging mode. */
const SINK_MODE = "pv";
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
    batteryBoost: false,
    batteryBoostLimit: BOOST_LIMIT_DISABLED,
    ...over,
  }) as EvccLoadpoint;

const state = (loadpoints: EvccLoadpoint[], reachable = true): EvccState =>
  ({ reachable, loadpoints, subtractFromHome: false }) as EvccState;

const inputs = (over: Partial<EvPullInInputs> = {}): EvPullInInputs => ({
  enabled: true,
  regime: "spend-down",
  evcc: state([loadpoint()]),
  boostLimitPct: 10,
  heldLoadpoints: [],
  ...over,
});

describe("planEvPullIn", () => {
  test("empties the pack with battery boost while it is still too full", () => {
    const plan = planEvPullIn(inputs());
    expect(plan.claim).toEqual([
      {
        loadpoint: 0,
        // Already on PV, so the user's mode is left exactly as it is.
        mode: null,
        boostLimitPct: 10,
        boost: true,
        remember: { mode: "pv", boostLimitPct: BOOST_LIMIT_DISABLED },
      },
    ]);
    expect(plan.release).toEqual([]);
  });

  test("wakes an idle charger, and only boosts once it is in a PV mode", () => {
    const plan = planEvPullIn(inputs({ evcc: state([loadpoint({ mode: "off" })]) }));
    expect(plan.claim[0]).toMatchObject({ mode: SINK_MODE, boost: true, boostLimitPct: 10 });
    // Handing `off` back is the whole point of remembering it.
    expect(plan.claim[0]?.remember).toEqual({ mode: "off", boostLimitPct: BOOST_LIMIT_DISABLED });
  });

  test("inside the window it soaks but does not boost — the pack should be filling", () => {
    // Draining the pack into the car during a window is a round trip that buys
    // nothing: the energy going in is already worthless.
    const plan = planEvPullIn(
      inputs({ regime: "absorb", evcc: state([loadpoint({ mode: "off" })]) }),
    );
    expect(plan.claim).toEqual([
      {
        loadpoint: 0,
        mode: SINK_MODE,
        boostLimitPct: null,
        boost: null,
        remember: { mode: "off", boostLimitPct: BOOST_LIMIT_DISABLED },
      },
    ]);
  });

  test("turns boost off at the window edge without letting go of the loadpoint", () => {
    const lp = loadpoint({ batteryBoost: true, batteryBoostLimit: 10 });
    const plan = planEvPullIn(inputs({ regime: "absorb", evcc: state([lp]), heldLoadpoints: [0] }));
    expect(plan.claim).toEqual([
      { loadpoint: 0, mode: null, boostLimitPct: null, boost: false, remember: null },
    ]);
    expect(plan.release).toEqual([]);
  });

  test("does nothing at all while switched off", () => {
    expect(planEvPullIn(inputs({ enabled: false })).claim).toEqual([]);
  });

  test("only acts in the regimes where a sink is actually wanted", () => {
    // `pre-shape` is the envelope coping on its own; reaching into the user's
    // charger to solve a problem that isn't happening would be a bad trade.
    expect(planEvPullIn(inputs({ regime: "absorb" })).claim).toHaveLength(0); // already on pv
    expect(planEvPullIn(inputs({ regime: "spend-down" })).claim).toHaveLength(1);
    for (const regime of ["pre-shape", "waiting", "none"] as const) {
      expect(planEvPullIn(inputs({ regime })).claim).toEqual([]);
    }
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

  test("never touches a charger the user put in `now`", () => {
    // It is charging as hard as it can already, EVCC refuses battery boost
    // outside the PV modes, and dropping it to `pv` would take away what the
    // user asked for.
    expect(planEvPullIn(inputs({ evcc: state([loadpoint({ mode: "now" })]) })).claim).toEqual([]);
  });

  test("the car's own limit stops a claim EVCC's higher one would allow", () => {
    // EVCC would charge to 80%, but the car is set to stop at 75% and is there
    // already: claiming it buys no sink, only a clobbered charger.
    const lp = loadpoint({ vehicleSoc: 75, effectiveLimitSoc: 80, vehicleLimitSoc: 75 });
    expect(planEvPullIn(inputs({ evcc: state([lp]) })).claim).toEqual([]);
  });

  test("an unknown SOC still claims — the worst case costs nothing", () => {
    // EVCC simply declines to charge a car that doesn't want energy, so guessing
    // "yes" is free while guessing "no" throws away the sink.
    const plan = planEvPullIn(inputs({ evcc: state([loadpoint({ vehicleSoc: null })]) }));
    expect(plan.claim).toHaveLength(1);
  });

  test("a loadpoint already in the wanted state produces no commands", () => {
    // The convergence property: a 30-second tick must not republish settings
    // that are already right, or it would overwrite the remembered originals.
    const lp = loadpoint({ batteryBoost: true, batteryBoostLimit: 10 });
    const plan = planEvPullIn(inputs({ evcc: state([lp]), heldLoadpoints: [0] }));
    expect(plan.claim).toEqual([]);
    expect(plan.release).toEqual([]);
  });

  test("a held loadpoint is never re-remembered", () => {
    // Re-remembering would overwrite the snapshot with our own settings and the
    // car would never get its originals back.
    const lp = loadpoint({ batteryBoost: false, batteryBoostLimit: 10 });
    const plan = planEvPullIn(inputs({ evcc: state([lp]), heldLoadpoints: [0] }));
    expect(plan.claim).toEqual([
      { loadpoint: 0, mode: null, boostLimitPct: null, boost: true, remember: null },
    ]);
  });

  test("re-issues a boost EVCC rejected, without re-issuing the limit", () => {
    // EVCC refuses boost outside a PV mode, so a boost sent in the same tick as
    // the mode change can be dropped. The next tick sees the mode landed and the
    // boost missing, and asks again.
    const lp = loadpoint({ mode: SINK_MODE, batteryBoost: false, batteryBoostLimit: 10 });
    const plan = planEvPullIn(inputs({ evcc: state([lp]), heldLoadpoints: [0] }));
    expect(plan.claim[0]).toMatchObject({ mode: null, boostLimitPct: null, boost: true });
  });

  test("hands back everything held once the window is over", () => {
    const plan = planEvPullIn(inputs({ regime: "waiting", heldLoadpoints: [0, 1] }));
    expect(plan.release).toEqual([
      { loadpoint: 0, restoreMode: true },
      { loadpoint: 1, restoreMode: true },
    ]);
  });

  test("hands back a car that was unplugged mid-window", () => {
    const plan = planEvPullIn(
      inputs({ evcc: state([loadpoint({ connected: false })]), heldLoadpoints: [0] }),
    );
    expect(plan.release).toEqual([{ loadpoint: 0, restoreMode: true }]);
  });

  test("hands back when EVCC goes unreachable, rather than forgetting the claim", () => {
    const plan = planEvPullIn(inputs({ evcc: state([loadpoint()], false), heldLoadpoints: [0] }));
    // Nothing visible to compare against, so the mode is handed back too — the
    // command throws while the broker is down and the loadpoint stays held.
    expect(plan.release).toEqual([{ loadpoint: 0, restoreMode: true }]);
  });

  test("a loadpoint with no reported mode degrades to handing back `off`", () => {
    const plan = planEvPullIn(inputs({ evcc: state([loadpoint({ mode: null })]) }));
    expect(plan.claim[0]?.remember).toEqual({ mode: "off", boostLimitPct: BOOST_LIMIT_DISABLED });
  });

  test("an unreported boost limit degrades to EVCC's own disabled value", () => {
    // Handing back `null` would be handing back nothing; 100 is what EVCC means
    // by "no boost limit", and is its default.
    const plan = planEvPullIn(inputs({ evcc: state([loadpoint({ batteryBoostLimit: null })]) }));
    expect(plan.claim[0]?.remember?.boostLimitPct).toBe(BOOST_LIMIT_DISABLED);
  });
});

describe("letting go", () => {
  test("a charger the user has taken over keeps their mode", () => {
    // We only ever set `pv`; anything else means someone changed it since, and
    // their choice is fresher than our snapshot. EVCC's persisted boost limit is
    // still handed back.
    const lp = loadpoint({ mode: "now" });
    const plan = planEvPullIn(
      inputs({ regime: "waiting", evcc: state([lp]), heldLoadpoints: [0] }),
    );
    expect(plan.release).toEqual([{ loadpoint: 0, restoreMode: false }]);
  });

  test("a charger still on the mode we set gets it back", () => {
    const plan = planEvPullIn(inputs({ regime: "waiting", heldLoadpoints: [0] }));
    expect(plan.release).toEqual([{ loadpoint: 0, restoreMode: true }]);
  });
});
