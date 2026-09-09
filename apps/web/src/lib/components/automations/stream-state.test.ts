import { describe, expect, test } from "bun:test";
import type {
  AutomationStreamMessage,
  PeakShavingPlan,
  PeakShavingPlans,
  PeakShavingStatus,
} from "$lib/automations";
import { applyAutomationFrame, emptyAutomationStream } from "./stream-state";

const status = (lastTickAt: string | null = null): PeakShavingStatus => ({
  enabled: true,
  mode: "maximize-exports",
  state: "active",
  blockers: [],
  priceBlockers: [],
  lastTickAt,
  lastWriteAt: null,
  lastError: null,
  targetA: 20,
  lastWrittenA: 20,
  liveA: 20,
  thresholdW: 5500,
  sellLimitW: null,
  liveSellLimitW: null,
  gridChargeA: null,
  liveExcessW: null,
  loadW: 1000,
  headroomKwh: null,
  usableKwh: null,
  remainingAboveLimitKwh: null,
  evChargeW: null,
  evDemandKwh: null,
  forecastAvailable: true,
  externalOverride: false,
  ineffective: false,
  restorePending: false,
  priceRegime: "none",
  socEnvelopePct: null,
  windowStartsAt: null,
  windowEndsAt: null,
  soakableKwh: null,
  unavoidableZeroValueKwh: null,
});

const emptyPlan = (): PeakShavingPlan => ({
  slots: [],
  chargeStartsAt: null,
  fullAt: null,
  endSocPct: 50,
  storedKwh: 0,
  exportedKwh: 0,
  curtailedKwh: 0,
});

const plans = (): PeakShavingPlans => ({ today: emptyPlan(), tomorrow: emptyPlan() });

/**
 * A frame. There is only ONE kind now: the subscribe-time snapshot and every
 * per-tick frame carry exactly these three fields, so nothing here has to sniff
 * which variant it is holding — and neither does the page.
 */
const frame = (over: Partial<AutomationStreamMessage> = {}): AutomationStreamMessage => ({
  tickMs: 30_000,
  status: status("2026-07-27T12:00:00Z"),
  plan: null,
  ...over,
});

describe("applying frames", () => {
  test("the first frame paints — nothing is loaded before it", () => {
    const before = emptyAutomationStream();
    expect(before.loaded).toBe(false);
    const after = applyAutomationFrame(before, frame(), 1000);
    expect(after.loaded).toBe(true);
    expect(after.tickMs).toBe(30_000);
    expect(after.status?.state).toBe("active");
  });

  test("a frame carries no decisions at all — those are read from history", () => {
    // The field this asserts the ABSENCE of is the whole point of #172: the
    // frame used to replay a 2 880-point ring on every (re)subscribe, and that
    // ring was the only copy of what the optimizer had decided.
    expect(Object.keys(frame()).sort()).toEqual(["plan", "status", "tickMs"]);
  });

  test("a plan that disappears clears the projection", () => {
    const withPlan = applyAutomationFrame(emptyAutomationStream(), frame({ plan: plans() }), 1000);
    expect(withPlan.plan).not.toBeNull();
    expect(applyAutomationFrame(withPlan, frame(), 2000).plan).toBeNull();
  });

  test("every frame replaces the status rather than merging into it", () => {
    // A blocker that cleared, an error that resolved: the server's status is the
    // whole truth on every frame, and a merge would keep a stale half of it.
    const seeded = applyAutomationFrame(emptyAutomationStream(), frame(), 1000);
    const cleared = frame({ status: { ...status("2026-07-27T12:00:30Z"), state: "blocked" } });
    expect(applyAutomationFrame(seeded, cleared, 2000).status?.state).toBe("blocked");
  });
});

describe("the countdown anchor", () => {
  test("a fresh tick anchors on the frame's arrival, never on the server's clock", () => {
    // Server timestamps are never compared against the viewer's clock: a skew
    // larger than the interval would pin the countdown at 0.
    expect(applyAutomationFrame(emptyAutomationStream(), frame(), 4242).tickArrivedAt).toBe(4242);
  });

  test("a frame repeating the same lastTickAt keeps the anchor it had", () => {
    const seeded = applyAutomationFrame(emptyAutomationStream(), frame(), 1000);
    expect(applyAutomationFrame(seeded, frame(), 9000).tickArrivedAt).toBe(1000);
  });

  test("a tick that has never run yet leaves the anchor unset", () => {
    const after = applyAutomationFrame(emptyAutomationStream(), frame({ status: status(null) }), 1);
    expect(after.tickArrivedAt).toBeNull();
  });
});
