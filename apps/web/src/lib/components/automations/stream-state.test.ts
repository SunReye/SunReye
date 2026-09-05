import { describe, expect, test } from "bun:test";
import type {
  AutomationStreamMessage,
  DecisionPoint,
  PeakShavingPlan,
  PeakShavingPlans,
  PeakShavingStatus,
} from "$lib/automations";
import {
  HISTORY_CAPACITY,
  applyAutomationFrame,
  emptyAutomationStream,
  isSnapshotFrame,
} from "./stream-state";

const T0 = Date.parse("2026-07-27T12:00:00Z");

const point = (t: number): DecisionPoint => ({
  t,
  shadow: false,
  pvW: 8000,
  loadW: 1000,
  evChargeW: null,
  localSinkW: 1000,
  thresholdW: 5500,
  targetA: 20,
  liveA: 20,
  batteryV: 50,
  chargeW: null,
  exportW: null,
  socPct: 42,
});

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

/** The subscribe-time frame: the whole ring, no new decision of its own. */
const snapshot = (
  history: DecisionPoint[],
  over: Partial<AutomationStreamMessage> = {},
): AutomationStreamMessage => ({
  tickMs: 30_000,
  status: status("2026-07-27T12:00:00Z"),
  point: null,
  history,
  plan: null,
  ...over,
});

/** A per-tick frame: one decision, never the ring. */
const tick = (
  decision: DecisionPoint | null,
  over: Partial<AutomationStreamMessage> = {},
): AutomationStreamMessage => ({
  tickMs: 30_000,
  status: status("2026-07-27T12:00:30Z"),
  point: decision,
  plan: null,
  ...over,
});

describe("which frame carries the ring", () => {
  test("a frame with a history array is the snapshot", () => {
    expect(isSnapshotFrame(snapshot([point(T0)]))).toBe(true);
  });

  test("an empty history is still a snapshot — a restarted engine has an empty ring", () => {
    expect(isSnapshotFrame(snapshot([]))).toBe(true);
  });

  test("a tick frame omits history entirely", () => {
    expect(isSnapshotFrame(tick(point(T0)))).toBe(false);
  });
});

describe("applying frames", () => {
  test("the snapshot seeds the ring and paints — nothing is loaded before it", () => {
    const before = emptyAutomationStream();
    expect(before.loaded).toBe(false);
    const after = applyAutomationFrame(before, snapshot([point(T0), point(T0 + 30_000)]), 1000);
    expect(after.history.map((p) => p.t)).toEqual([T0, T0 + 30_000]);
    expect(after.loaded).toBe(true);
    expect(after.tickMs).toBe(30_000);
  });

  test("a reconnect snapshot replaces the ring rather than merging into it", () => {
    // The server's ring is the truth on every (re)subscribe: an engine that
    // restarted has dropped its points, and keeping ours would paint decisions
    // the engine no longer claims.
    const seeded = applyAutomationFrame(emptyAutomationStream(), snapshot([point(T0)]), 1000);
    const after = applyAutomationFrame(seeded, snapshot([point(T0 + 900_000)]), 2000);
    expect(after.history.map((p) => p.t)).toEqual([T0 + 900_000]);
  });

  test("a tick frame grows the ring by its one point", () => {
    const seeded = applyAutomationFrame(emptyAutomationStream(), snapshot([point(T0)]), 1000);
    const after = applyAutomationFrame(seeded, tick(point(T0 + 30_000)), 2000);
    expect(after.history.map((p) => p.t)).toEqual([T0, T0 + 30_000]);
  });

  test("the snapshot's history and a live point arriving in the same tick dedupe on point.t", () => {
    // The server backfills on subscribe and then promotes the topic to the live
    // fan-out; the tick that produced the ring's last point can be buffered and
    // replayed right behind the snapshot that already contains it. Appending it
    // would draw the same decision twice on every chart.
    const seeded = applyAutomationFrame(
      emptyAutomationStream(),
      snapshot([point(T0), point(T0 + 30_000)]),
      1000,
    );
    const after = applyAutomationFrame(seeded, tick(point(T0 + 30_000)), 1000);
    expect(after.history.map((p) => p.t)).toEqual([T0, T0 + 30_000]);
  });

  test("a snapshot that also carries a point folds it in without duplicating the ring tail", () => {
    const after = applyAutomationFrame(
      emptyAutomationStream(),
      snapshot([point(T0), point(T0 + 30_000)], { point: point(T0 + 30_000) }),
      1000,
    );
    expect(after.history.map((p) => p.t)).toEqual([T0, T0 + 30_000]);
  });

  test("a snapshot carrying a decision its ring does not hold still keeps that decision", () => {
    // The frame's two variants are additive, not exclusive: whatever `point`
    // says is folded on top of whatever `history` says. Treating a snapshot as
    // "ring only" would silently drop a tick the server sent in the same frame.
    const after = applyAutomationFrame(
      emptyAutomationStream(),
      snapshot([point(T0)], { point: point(T0 + 30_000) }),
      1000,
    );
    expect(after.history.map((p) => p.t)).toEqual([T0, T0 + 30_000]);
  });

  test("a tick that decided nothing leaves the ring alone but still paints", () => {
    const after = applyAutomationFrame(emptyAutomationStream(), tick(null), 1000);
    expect(after.history).toEqual([]);
    expect(after.loaded).toBe(true);
  });

  test("the ring never grows past the server's capacity", () => {
    const full = applyAutomationFrame(
      emptyAutomationStream(),
      snapshot(Array.from({ length: HISTORY_CAPACITY }, (_, i) => point(T0 + i * 30_000))),
      1000,
    );
    const after = applyAutomationFrame(full, tick(point(T0 + HISTORY_CAPACITY * 30_000)), 2000);
    expect(after.history).toHaveLength(HISTORY_CAPACITY);
    expect(after.history[0]?.t).toBe(T0 + 30_000);
    expect(after.history.at(-1)?.t).toBe(T0 + HISTORY_CAPACITY * 30_000);
  });

  test("a plan that disappears clears the projection", () => {
    const withPlan = applyAutomationFrame(
      emptyAutomationStream(),
      snapshot([], { plan: plans() }),
      1000,
    );
    expect(withPlan.plan).not.toBeNull();
    expect(applyAutomationFrame(withPlan, tick(null), 2000).plan).toBeNull();
  });
});

describe("the countdown anchor", () => {
  test("a fresh tick anchors on the frame's arrival, never on the server's clock", () => {
    // Server timestamps are never compared against the viewer's clock: a skew
    // larger than the interval would pin the countdown at 0.
    const after = applyAutomationFrame(emptyAutomationStream(), snapshot([]), 4242);
    expect(after.tickArrivedAt).toBe(4242);
  });

  test("a frame repeating the same lastTickAt keeps the anchor it had", () => {
    const seeded = applyAutomationFrame(emptyAutomationStream(), snapshot([]), 1000);
    const repeat = tick(null, { status: status("2026-07-27T12:00:00Z") });
    expect(applyAutomationFrame(seeded, repeat, 9000).tickArrivedAt).toBe(1000);
  });

  test("a tick that has never run yet leaves the anchor unset", () => {
    const after = applyAutomationFrame(
      emptyAutomationStream(),
      snapshot([], { status: status(null) }),
      1000,
    );
    expect(after.tickArrivedAt).toBeNull();
  });
});
