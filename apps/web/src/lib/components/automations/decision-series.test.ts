import { describe, expect, test } from "bun:test";
import type { DecisionPoint } from "$lib/automations";
import {
  DECISION_WINDOWS,
  MAX_PLOT_POINTS,
  hasLoad,
  hasRegister,
  toDecisionRows,
} from "./decision-series";

const T0 = Date.parse("2026-07-27T12:00:00Z");

const point = (over: Partial<DecisionPoint> = {}): DecisionPoint => ({
  t: T0,
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
  socPct: 50,
  ...over,
});

describe("toDecisionRows", () => {
  test("no points → nothing to plot", () => {
    expect(toDecisionRows([], DECISION_WINDOWS["24h"])).toEqual([]);
  });

  test("scales to kW and derives the export the decision implies", () => {
    // 8 kW PV − 1 kW local sink − (20 A × 50 V = 1 kW) charging → 6 kW exported.
    const [row] = toDecisionRows([point()], DECISION_WINDOWS["1h"]);
    expect(row).toMatchObject({
      pvKw: 8,
      loadKw: 1,
      batteryKw: 1,
      exportKw: 6,
      thresholdKw: 5.5,
      targetA: 20,
      registerA: 20,
      shadow: false,
    });
    expect(row?.t.getTime()).toBe(T0);
  });

  test("never reports a negative export", () => {
    const [row] = toDecisionRows(
      [point({ pvW: 1000, localSinkW: 1500, targetA: 20 })],
      DECISION_WINDOWS["1h"],
    );
    expect(row?.exportKw).toBe(0);
  });

  test("unknown load plots as zero, measured readings stay null", () => {
    const [row] = toDecisionRows([point({ loadW: null })], DECISION_WINDOWS["1h"]);
    expect(row).toMatchObject({ loadKw: 0, measuredExportKw: null, measuredChargeKw: null });
  });

  test("measured readings ride along for the tooltip", () => {
    const [row] = toDecisionRows([point({ exportW: 4200, chargeW: 900 })], DECISION_WINDOWS["1h"]);
    expect(row).toMatchObject({ measuredExportKw: 4.2, measuredChargeKw: 0.9 });
  });

  test("the window is anchored to the newest sample", () => {
    const points = [
      point({ t: T0 - 3 * 3600_000 }), // 3 h old — outside a 1 h window
      point({ t: T0 - 600_000 }),
      point({ t: T0 }),
    ];
    const rows = toDecisionRows(points, DECISION_WINDOWS["1h"]);
    expect(rows.map((r) => r.t.getTime())).toEqual([T0 - 600_000, T0]);
  });

  test("long windows are strided down but keep the newest sample", () => {
    const count = MAX_PLOT_POINTS * 3 + 7;
    const points = Array.from({ length: count }, (_, i) =>
      point({ t: T0 - (count - 1 - i) * 30_000 }),
    );
    const rows = toDecisionRows(points, DECISION_WINDOWS["24h"]);
    expect(rows.length).toBeLessThanOrEqual(MAX_PLOT_POINTS + 1);
    expect(rows.at(-1)?.t.getTime()).toBe(T0);
    expect(rows[0]?.t.getTime()).toBe(points[0]?.t);
  });
});

describe("series availability", () => {
  test("a series is only plotted when some point carries its reading", () => {
    expect(hasLoad([point({ loadW: null })])).toBe(false);
    expect(hasLoad([point({ loadW: null }), point({ loadW: 800 })])).toBe(true);
    expect(hasRegister([point({ liveA: null })])).toBe(false);
    expect(hasRegister([point()])).toBe(true);
  });
});
