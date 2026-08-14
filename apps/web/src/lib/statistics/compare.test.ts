import { describe, expect, test } from "bun:test";
import type { ComparisonResponse } from "server/src/statistics/statistics";
import { deltaFor, referenceWindow, usableComparison, windowDays } from "./compare";

describe("deltaFor", () => {
  test("signs the relative change", () => {
    expect(deltaFor(110, 100)).toBeCloseTo(0.1);
    expect(deltaFor(90, 100)).toBeCloseTo(-0.1);
    expect(deltaFor(100, 100)).toBe(0);
  });

  test("measures against the magnitude of a negative reference", () => {
    // Dividing by |previous| keeps the sign meaning "moved down" even when the
    // reference is negative: −20 after −10 is a further −100%, and the tile's
    // goodDirection decides whether down is good news.
    expect(deltaFor(-20, -10)).toBeCloseTo(-1);
    expect(deltaFor(-5, -10)).toBeCloseTo(0.5);
  });

  test("has no answer without a usable reference", () => {
    expect(deltaFor(10, 0)).toBeNull();
    expect(deltaFor(10, null)).toBeNull();
    expect(deltaFor(null, 10)).toBeNull();
    expect(deltaFor(Number.NaN, 10)).toBeNull();
  });
});

describe("referenceWindow", () => {
  test("previous is the adjacent same-length window", () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-08T00:00:00.000Z");
    const ref = referenceWindow(from, to, "previous");
    expect(ref.from.toISOString()).toBe("2026-06-24T00:00:00.000Z");
    expect(ref.to.toISOString()).toBe(from.toISOString());
  });

  test("yearAgo shifts the calendar window back one year", () => {
    const from = new Date(2026, 6, 1);
    const to = new Date(2026, 7, 1);
    const ref = referenceWindow(from, to, "yearAgo");
    expect(ref.from.getFullYear()).toBe(2025);
    expect(ref.from.getMonth()).toBe(6);
    expect(ref.to.getFullYear()).toBe(2025);
  });
});

describe("usableComparison", () => {
  const reference = { from: new Date("2026-06-01T00:00:00.000Z") };
  const payload = (dataFrom: string | null) =>
    ({
      mode: "previous",
      current: { net: 20 },
      previous: { net: 30 },
      coverage: { dataFrom },
    }) as unknown as ComparisonResponse;

  test("keeps the reference once history starts at or before it", () => {
    expect(usableComparison(payload("2026-05-01T00:00:00.000Z"), reference).previous).toMatchObject(
      { net: 30 },
    );
    expect(
      usableComparison(payload("2026-06-01T00:00:00.000Z"), reference).previous,
    ).not.toBeNull();
  });

  test("drops a reference window that predates recorded history", () => {
    expect(usableComparison(payload("2026-06-15T00:00:00.000Z"), reference)).toMatchObject({
      current: { net: 20 },
      previous: null,
    });
    expect(usableComparison(payload(null), reference).previous).toBeNull();
  });

  test("has nothing at all without a payload", () => {
    expect(usableComparison(null, reference)).toEqual({ current: null, previous: null });
  });
});

describe("windowDays", () => {
  test("counts whole days, never below one", () => {
    expect(windowDays(new Date(2026, 6, 1), new Date(2026, 7, 1))).toBe(31);
    expect(windowDays(new Date(2026, 6, 1), new Date(2026, 6, 1, 6))).toBe(1);
  });
});
