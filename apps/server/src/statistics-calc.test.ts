import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CostSeriesPoint, CounterDeltaRow, EnergyField } from "./cost";
import { type EnergyTotals, derivePeriodEnergy } from "./energy-calc";
import {
  heatmapCells,
  hodDowOccurrences,
  pickEnergyRecords,
  pickMoneyRecords,
  previousWindow,
} from "./statistics-calc";

// DST-sensitive math (occurrence counting, previous-window length) is pinned
// to a known zone. Bun applies process.env.TZ changes at runtime; restore the
// original so other test files in the process are unaffected.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Berlin";
});
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("previousWindow", () => {
  test("previous: adjacent same-length window ending at from", () => {
    const from = new Date(2025, 2, 10); // Mon Mar 10
    const to = new Date(2025, 2, 17);
    const prev = previousWindow(from, to, "previous");
    expect(prev.to.getTime()).toBe(from.getTime());
    expect(prev.from.getTime()).toBe(new Date(2025, 2, 3).getTime());
  });

  test("previous: preserves millisecond length across a DST boundary", () => {
    // Berlin spring-forward day: [Mar 30, Mar 31) is only 23 real hours.
    const from = new Date(2025, 2, 30);
    const to = new Date(2025, 2, 31);
    const len = to.getTime() - from.getTime();
    expect(len).toBe(23 * 3_600_000);
    const prev = previousWindow(from, to, "previous");
    expect(prev.to.getTime()).toBe(from.getTime());
    expect(prev.to.getTime() - prev.from.getTime()).toBe(len);
    // 23h before Mar 30 00:00 is Mar 29 01:00 local.
    expect(prev.from.getTime()).toBe(new Date(2025, 2, 29, 1).getTime());
  });

  test("yearAgo: calendar shift by one year", () => {
    const prev = previousWindow(new Date(2025, 5, 1), new Date(2025, 6, 1), "yearAgo");
    expect(prev.from.getTime()).toBe(new Date(2024, 5, 1).getTime());
    expect(prev.to.getTime()).toBe(new Date(2024, 6, 1).getTime());
  });

  test("yearAgo: Feb 29 normalizes to Mar 1 (Date semantics)", () => {
    const prev = previousWindow(new Date(2024, 1, 29), new Date(2024, 2, 1), "yearAgo");
    expect(prev.from.getTime()).toBe(new Date(2023, 2, 1).getTime());
    expect(prev.to.getTime()).toBe(new Date(2023, 2, 1).getTime()); // collapses to empty
  });
});

const totalSlots = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

describe("hodDowOccurrences", () => {
  test("plain full week: every (hod, dow) slot exactly once", () => {
    const m = hodDowOccurrences(new Date(2025, 5, 2), new Date(2025, 5, 9)); // Mon→Mon
    expect(m.size).toBe(168);
    expect(totalSlots(m)).toBe(168);
    expect(m.get("1:0")).toBe(1);
    expect(m.get("7:23")).toBe(1);
  });

  test("spring-forward day has 23 slots and no 02:00", () => {
    const m = hodDowOccurrences(new Date(2025, 2, 30), new Date(2025, 2, 31)); // Sun
    expect(totalSlots(m)).toBe(23);
    expect(m.get("7:2")).toBeUndefined();
    expect(m.get("7:1")).toBe(1);
    expect(m.get("7:3")).toBe(1);
  });

  test("fall-back day has 25 slots and 02:00 twice", () => {
    const m = hodDowOccurrences(new Date(2025, 9, 26), new Date(2025, 9, 27)); // Sun
    expect(totalSlots(m)).toBe(25);
    expect(m.get("7:2")).toBe(2);
  });

  test("mid-hour from: only full hour slots at or after from count", () => {
    const m = hodDowOccurrences(new Date(2025, 5, 2, 10, 30), new Date(2025, 5, 2, 13)); // Mon
    expect([...m.keys()].sort()).toEqual(["1:11", "1:12"]);
  });
});

describe("heatmapCells", () => {
  const fields: EnergyField[] = [
    "import",
    "export",
    "load",
    "production",
    "batteryDischarge",
    "batteryCharge",
  ];
  const fieldByKey = new Map<string, EnergyField>([
    ["k_imp", "import"],
    ["k_load", "load"],
  ]);
  const row = (r: Partial<CounterDeltaRow>): CounterDeltaRow => ({
    period: "2025-06",
    hod: 0,
    dow: 1,
    metric: "k_imp",
    kwh: 0,
    ...r,
  });

  test("zero-fills one cell per occurring slot, all energy fields present", () => {
    const occurrences = new Map([
      ["1:0", 2],
      ["1:1", 1],
    ]);
    const cells = heatmapCells([], fieldByKey, fields, occurrences);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toEqual({
      hod: 0,
      dow: 1,
      occurrences: 2,
      importKwh: 0,
      exportKwh: 0,
      loadKwh: 0,
      productionKwh: 0,
      batteryDischargeKwh: 0,
      batteryChargeKwh: 0,
    });
    expect(cells[1]?.hod).toBe(1);
  });

  test("sums matching rows across periods into one cell; ignores unknown metrics and out-of-window slots", () => {
    const occurrences = new Map([["1:0", 2]]);
    const cells = heatmapCells(
      [
        row({ kwh: 1.5 }),
        row({ period: "2025-07", kwh: 2.5 }),
        row({ metric: "k_load", kwh: 3 }),
        row({ metric: "unmapped", kwh: 99 }), // metric not in fieldByKey
        row({ hod: 5, kwh: 99 }), // slot not in the window
      ],
      fieldByKey,
      fields,
      occurrences,
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]?.importKwh).toBe(4);
    expect(cells[0]?.loadKwh).toBe(3);
    expect(cells[0]?.exportKwh).toBe(0);
  });

  test("sorts cells by weekday then hour", () => {
    const occurrences = new Map([
      ["7:0", 1],
      ["1:5", 1],
      ["1:2", 1],
    ]);
    const cells = heatmapCells([], fieldByKey, fields, occurrences);
    expect(cells.map((c) => `${c.dow}:${c.hod}`)).toEqual(["1:2", "1:5", "7:0"]);
  });
});

const day = (date: string, t: Partial<EnergyTotals>) =>
  derivePeriodEnergy(date, {
    importKwh: 0,
    exportKwh: 0,
    loadKwh: 0,
    productionKwh: 0,
    batteryDischargeKwh: 0,
    batteryChargeKwh: 0,
    ...t,
  });

describe("pickEnergyRecords", () => {
  test("picks per-metric extremes independently", () => {
    const r = pickEnergyRecords([
      day("2025-06-01", { productionKwh: 30, exportKwh: 20, loadKwh: 10, importKwh: 1 }),
      day("2025-06-02", { productionKwh: 42, exportKwh: 5, loadKwh: 12, importKwh: 9 }),
    ]);
    expect(r.maxProductionDay).toEqual({ date: "2025-06-02", value: 42 });
    expect(r.maxExportDay).toEqual({ date: "2025-06-01", value: 20 });
    expect(r.maxLoadDay).toEqual({ date: "2025-06-02", value: 12 });
    expect(r.maxImportDay).toEqual({ date: "2025-06-02", value: 9 });
  });

  test("zero-filled days never become max records", () => {
    const r = pickEnergyRecords([day("2025-06-01", {}), day("2025-06-02", { productionKwh: 3 })]);
    expect(r.maxProductionDay).toEqual({ date: "2025-06-02", value: 3 });
    expect(r.maxExportDay).toBeNull();
    expect(r.maxLoadDay).toBeNull();
    expect(r.maxImportDay).toBeNull();
  });

  test("self-sufficiency records need at least 1 kWh of load", () => {
    const r = pickEnergyRecords([
      day("2025-06-01", { loadKwh: 0.5, importKwh: 0 }), // SS 1.0 but below the floor
      day("2025-06-02", { loadKwh: 10, importKwh: 2 }), // SS 0.8
      day("2025-06-03", { loadKwh: 10, importKwh: 9 }), // SS 0.1
    ]);
    expect(r.bestSelfSufficiencyDay).toEqual({ date: "2025-06-02", value: 0.8 });
    expect(r.worstSelfSufficiencyDay).toEqual({ date: "2025-06-03", value: 0.1 });
  });

  // Both extremes are picked strictly, so an equalled record never moves to a
  // later day — "since when" stays the day it was first reached.
  test("tied days keep the earliest date", () => {
    const r = pickEnergyRecords([
      day("2025-06-01", { productionKwh: 9, loadKwh: 10, importKwh: 2 }), // SS 0.8
      day("2025-06-02", { productionKwh: 9, loadKwh: 10, importKwh: 2 }), // SS 0.8
    ]);
    expect(r.maxProductionDay).toEqual({ date: "2025-06-01", value: 9 });
    expect(r.bestSelfSufficiencyDay).toEqual({ date: "2025-06-01", value: 0.8 });
    expect(r.worstSelfSufficiencyDay).toEqual({ date: "2025-06-01", value: 0.8 });
  });

  test("empty history yields all-null records", () => {
    const r = pickEnergyRecords([]);
    expect(r.maxProductionDay).toBeNull();
    expect(r.bestSelfSufficiencyDay).toBeNull();
    expect(r.worstSelfSufficiencyDay).toBeNull();
  });
});

describe("pickMoneyRecords", () => {
  const point = (bucket: string, p: Partial<CostSeriesPoint>): CostSeriesPoint => ({
    bucket,
    importCost: 0,
    exportEarnings: 0,
    zeroValueExportKwh: 0,
    zeroValueExportEur: 0,
    standingCharge: 0,
    net: 0,
    ...p,
  });

  test("picks net extremes and the best earnings day", () => {
    const r = pickMoneyRecords([
      point("2025-06-01", { net: 1.2, exportEarnings: 0.5 }),
      point("2025-06-02", { net: -0.4, exportEarnings: 2.1 }),
      point("2025-06-03", { net: 3.0, exportEarnings: 0.1 }),
    ]);
    expect(r.cheapestDay).toEqual({ date: "2025-06-02", value: -0.4 });
    expect(r.mostExpensiveDay).toEqual({ date: "2025-06-03", value: 3.0 });
    expect(r.bestEarningsDay).toEqual({ date: "2025-06-02", value: 2.1 });
  });

  test("tied days keep the earliest date", () => {
    const r = pickMoneyRecords([
      point("2025-06-01", { net: 2, exportEarnings: 1 }),
      point("2025-06-02", { net: 2, exportEarnings: 1 }),
    ]);
    expect(r.cheapestDay).toEqual({ date: "2025-06-01", value: 2 });
    expect(r.mostExpensiveDay).toEqual({ date: "2025-06-01", value: 2 });
    expect(r.bestEarningsDay).toEqual({ date: "2025-06-01", value: 1 });
  });

  test("no positive earnings → no earnings record; empty input → all null", () => {
    const r = pickMoneyRecords([point("2025-06-01", { net: 1 })]);
    expect(r.bestEarningsDay).toBeNull();
    expect(r.cheapestDay).toEqual({ date: "2025-06-01", value: 1 });

    const empty = pickMoneyRecords([]);
    expect(empty.cheapestDay).toBeNull();
    expect(empty.mostExpensiveDay).toBeNull();
    expect(empty.bestEarningsDay).toBeNull();
  });
});
