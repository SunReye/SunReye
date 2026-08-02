import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CounterDeltaRow, EnergyField } from "./cost";
import { heatmapCells, hodDowOccurrences, previousWindow } from "./statistics-calc";

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
  const fields: EnergyField[] = ["import", "export", "load", "production", "batteryDischarge"];
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
