import { describe, expect, test } from "bun:test";
import { OPTIMIZER_RUN_STATES } from "@SunReye/inverter-core/optimizer";
import { MAX_PLOT_POINTS } from "$lib/history/series";
import { type DecisionSeries, hasLoad, hasRegister, toDecisionRows } from "./decision-series";

const T0 = Date.parse("2026-07-27T12:00:00Z");

/** Run-state ordinals by name, straight out of the vocabulary both sides share. */
const ORDINAL = {
  active: OPTIMIZER_RUN_STATES.indexOf("active"),
  shadow: OPTIMIZER_RUN_STATES.indexOf("shadow"),
  simulating: OPTIMIZER_RUN_STATES.indexOf("simulating"),
  stale: OPTIMIZER_RUN_STATES.indexOf("stale"),
};

/** An empty series — the shape a plant that meters nothing hands over. */
const none = (): Map<number, number> => new Map();

/** One series from `[t, value]` pairs. */
const series = (...points: [number, number][]): Map<number, number> => new Map(points);

/**
 * One bucket's worth of every series, at `t`. Minute buckets are the join key,
 * so every series in a row shares one timestamp by construction.
 */
function bucket(t: number, over: Partial<Record<keyof DecisionSeries, number | null>> = {}) {
  const values: Record<string, number | null> = {
    targetA: 20,
    appliedA: 20,
    thresholdW: 5500,
    localSinkW: 1000,
    // The ordinals come from the SHARED frozen vocabulary, never a literal: the
    // number in the database means whatever that list says at that position.
    stateMin: ORDINAL.active,
    stateMax: ORDINAL.active,
    pvW: 8000,
    loadW: 1000,
    batteryV: 50,
    batteryW: null,
    gridW: null,
    ...over,
  };
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      value === null ? none() : series([t, value]),
    ]),
  ) as DecisionSeries;
}

const empty = (): DecisionSeries =>
  bucket(0, {
    targetA: null,
    appliedA: null,
    thresholdW: null,
    localSinkW: null,
    stateMin: null,
    stateMax: null,
    pvW: null,
    loadW: null,
    batteryV: null,
    batteryW: null,
    gridW: null,
  });

describe("toDecisionRows", () => {
  test("no decisions → nothing to plot", () => {
    expect(toDecisionRows(empty())).toEqual([]);
  });

  test("scales to kW and derives the export the decision implies", () => {
    // 8 kW PV − 1 kW local sink − (20 A × 50 V = 1 kW) charging → 6 kW exported.
    const [row] = toDecisionRows(bucket(T0));
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
    const [row] = toDecisionRows(bucket(T0, { pvW: 1000, localSinkW: 1500 }));
    expect(row?.exportKw).toBe(0);
  });

  test("a plant that meters no house load plots zero, and no measured tooltip", () => {
    const [row] = toDecisionRows(bucket(T0, { loadW: null }));
    expect(row).toMatchObject({ loadKw: 0, measuredExportKw: null, measuredChargeKw: null });
  });

  test("measured readings ride along for the tooltip, on the power-flow signs", () => {
    // `grid.power` > 0 imports and `battery.power` > 0 discharges, so exporting
    // and charging are the negative halves.
    const [row] = toDecisionRows(bucket(T0, { gridW: -4200, batteryW: -900 }));
    expect(row).toMatchObject({ measuredExportKw: 4.2, measuredChargeKw: 0.9 });
  });

  test("importing and discharging are not negative export and charge", () => {
    const [row] = toDecisionRows(bucket(T0, { gridW: 2000, batteryW: 1500 }));
    expect(row).toMatchObject({ measuredExportKw: 0, measuredChargeKw: 0 });
  });

  test("a plant that meters no pack voltage cannot convert the ceiling to power", () => {
    // …and says so with a flat zero rather than inventing a nominal voltage.
    const [row] = toDecisionRows(bucket(T0, { batteryV: null }));
    expect(row).toMatchObject({ batteryKw: 0, targetA: 20 });
  });

  test("a shadow bucket is marked so the chart can label it", () => {
    // `shadow` and `simulating` both write nothing to the register, so a bucket
    // that held only those two is a bucket the automation did not touch.
    const held = (min: number, max: number) =>
      toDecisionRows(bucket(T0, { stateMin: min, stateMax: max }))[0]?.shadow;
    expect(held(ORDINAL.shadow, ORDINAL.shadow)).toBe(true);
    expect(held(ORDINAL.simulating, ORDINAL.simulating)).toBe(true);
    expect(held(ORDINAL.shadow, ORDINAL.simulating)).toBe(true);
  });

  test("a bucket that STEERED is not shadow, however its ordinals average out", () => {
    // The defect this closes: read as a time-weighted MEAN, a minute holding
    // `active` (3) and `stale` (6) averages to 4.5 — squarely inside
    // shadow…simulating — and the chart told the operator the register had not
    // been touched in a minute where it had. The bucket's EXTREMES answer it
    // exactly: the register was written unless every sample in the bucket was
    // one of the two states that write nothing.
    const held = (min: number, max: number) =>
      toDecisionRows(bucket(T0, { stateMin: min, stateMax: max }))[0]?.shadow;
    expect(held(ORDINAL.active, ORDINAL.stale)).toBe(false);
    // And the mixed cases either side of the range, for the same reason.
    expect(held(ORDINAL.active, ORDINAL.shadow)).toBe(false);
    expect(held(ORDINAL.simulating, ORDINAL.stale)).toBe(false);
  });

  test("a bucket the optimizer reported no state in is not called shadow", () => {
    expect(toDecisionRows(bucket(T0, { stateMin: null, stateMax: null }))[0]?.shadow).toBe(false);
  });

  test("rows are anchored on the DECISION, not on what the plant measured", () => {
    // A bucket the optimizer said nothing in is not a decision: plotting the
    // plant's readings there would draw a ceiling it never asked for.
    const rows = toDecisionRows({
      ...bucket(T0),
      targetA: series([T0, 20]),
      thresholdW: series([T0, 5500]),
      pvW: series([T0 - 60_000, 9000], [T0, 8000], [T0 + 60_000, 7000]),
    });
    expect(rows.map((r) => r.t.getTime())).toEqual([T0]);
  });

  test("a bucket the plant reported nothing in still plots the decision", () => {
    const rows = toDecisionRows({
      ...bucket(T0),
      targetA: series([T0, 20], [T0 + 60_000, 12]),
      thresholdW: series([T0, 5500]),
    });
    expect(rows.map((r) => [r.t.getTime(), r.targetA])).toEqual([
      [T0, 20],
      [T0 + 60_000, 12],
    ]);
    // Nothing measured is zero on the power plane, never a carried-forward value.
    expect(rows[1]?.pvKw).toBe(0);
  });

  test("a decision with no ceiling of its own still plots its threshold", () => {
    // The two are separate series and either may be the one that changed.
    const rows = toDecisionRows({ ...empty(), thresholdW: series([T0, 4000]) });
    expect(rows.map((r) => [r.t.getTime(), r.thresholdKw, r.targetA])).toEqual([[T0, 4, 0]]);
  });

  test("a long window is strided down but keeps the newest sample", () => {
    const count = MAX_PLOT_POINTS * 3 + 7;
    const targetA = new Map(
      Array.from(
        { length: count },
        (_, i) => [T0 - (count - 1 - i) * 60_000, i] as [number, number],
      ),
    );
    const rows = toDecisionRows({ ...empty(), targetA });
    expect(rows.length).toBeLessThanOrEqual(MAX_PLOT_POINTS + 1);
    expect(rows.at(-1)?.t.getTime()).toBe(T0);
    expect(rows[0]?.t.getTime()).toBe(T0 - (count - 1) * 60_000);
  });
});

describe("series availability", () => {
  test("a series is only plotted when the rows carry its reading", () => {
    expect(hasLoad(toDecisionRows(bucket(T0, { loadW: null })))).toBe(false);
    expect(hasLoad(toDecisionRows(bucket(T0)))).toBe(true);
    expect(hasRegister(toDecisionRows(bucket(T0, { appliedA: null })))).toBe(false);
    expect(hasRegister(toDecisionRows(bucket(T0)))).toBe(true);
  });

  test("a written zero is still a written value", () => {
    // `0 A` is the automation holding the battery off, which is a decision it
    // made — not an absence of one.
    expect(hasRegister(toDecisionRows(bucket(T0, { appliedA: 0 })))).toBe(true);
  });
});
