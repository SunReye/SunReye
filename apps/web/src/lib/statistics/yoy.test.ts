import { describe, expect, test } from "bun:test";
import { groupYoy, hasYoyData, yoyWindow } from "./yoy";

describe("yoyWindow", () => {
  test("is the trailing 24 months of the PLANT's calendar", () => {
    // 23:30 UTC on New Year's Eve is already 2026 in Berlin: the plant's
    // current year is 2026, and the window opens on a Berlin month start.
    const w = yoyWindow(new Date("2025-12-31T23:30:00Z"), "Europe/Berlin");
    expect(w.year).toBe(2026);
    expect(w.from.toISOString()).toBe("2024-01-31T23:00:00.000Z"); // Berlin Feb 1 2024
    expect(w.to.toISOString()).toBe("2025-12-31T23:30:00.000Z");
  });
});

const rows = [
  { bucket: "2025-01", value: 10 },
  { bucket: "2025-07", value: 70 },
  { bucket: "2026-01", value: 12 },
  { bucket: "2026-07", value: 84 },
  { bucket: "2024-07", value: 1 },
];

describe("groupYoy", () => {
  const grouped = groupYoy(rows, 2026);

  test("always yields the twelve calendar months in order", () => {
    expect(grouped).toHaveLength(12);
    expect(grouped.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(grouped[6]?.bucket).toBe("2026-07");
  });

  test("pairs each month with the same month a year earlier", () => {
    expect(grouped[0]).toMatchObject({ current: 12, previous: 10 });
    expect(grouped[6]).toMatchObject({ current: 84, previous: 70 });
  });

  test("leaves months without a row null rather than zero", () => {
    expect(grouped[1]).toMatchObject({ current: null, previous: null });
  });

  test("ignores periods outside the two charted years", () => {
    expect(grouped.some((r) => r.current === 1 || r.previous === 1)).toBe(false);
  });
});

describe("hasYoyData", () => {
  test("false only when both years are empty throughout", () => {
    expect(hasYoyData(groupYoy(rows, 2026))).toBe(true);
    expect(hasYoyData(groupYoy(rows, 2030))).toBe(false);
  });
});
