/**
 * The counter arithmetic, boundary by boundary.
 *
 * These tests moved here with the module they cover (from
 * `scripts/fixture-1-2-0.test.ts`) when `apps/server/db-tests/replay.test.ts`
 * needed the same arithmetic: a database test cannot import from `scripts/`, and
 * a copy of the counter rule in the test layer would be a second answer to the
 * question the whole 2.0.0 release turns on.
 */
import { describe, expect, test } from "bun:test";

import { counterIncrement, describeRestarts, energyOf, perDayEnergy } from "./counter-energy";

describe("counterIncrement", () => {
  test("a normal step is the delta", () => {
    expect(counterIncrement(10, 12.5)).toBe(2.5);
  });

  test("a flat step contributes nothing", () => {
    expect(counterIncrement(10, 10)).toBe(0);
  });

  test("a reset contributes the post-reset value, not a negative delta", () => {
    expect(counterIncrement(45_000, 0)).toBe(0);
    expect(counterIncrement(45_000, 1.5)).toBe(1.5);
  });

  test("zero-to-zero and a negative reading never produce a negative increment", () => {
    expect(counterIncrement(0, 0)).toBe(0);
    expect(counterIncrement(5, -3)).toBe(0);
    expect(counterIncrement(-3, 0)).toBe(0);
  });
});

describe("perDayEnergy", () => {
  const reading = (metric: string, time: string, value: number) => ({ metric, time, value });

  test("an empty payload aggregates to nothing rather than throwing", () => {
    expect(perDayEnergy([])).toEqual([]);
  });

  test("a single reading has no delta to attribute, so the day is absent", () => {
    expect(perDayEnergy([reading("e", "2026-08-01T00:00:00Z", 5)])).toEqual([]);
  });

  test("a partial window sums only the deltas it has", () => {
    const rows = perDayEnergy([
      reading("e", "2026-08-01T10:00:00Z", 5),
      reading("e", "2026-08-01T11:00:00Z", 7),
      reading("e", "2026-08-01T12:00:00Z", 8),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.energy).toBeCloseTo(3, 9);
    expect(rows[0]?.naive).toBeCloseTo(3, 9);
    expect(rows[0]?.resets).toBe(0);
  });

  test("a step across midnight belongs to the later day", () => {
    const rows = perDayEnergy([
      reading("e", "2026-08-01T23:59:00Z", 10),
      reading("e", "2026-08-02T00:00:00Z", 11),
      reading("e", "2026-08-02T23:59:00Z", 20),
    ]);
    expect(rows.map((r) => r.day)).toEqual(["2026-08-02"]);
    expect(rows[0]?.energy).toBeCloseTo(10, 9);
  });

  test("unordered input is sorted before differencing", () => {
    const ordered = perDayEnergy([
      reading("e", "2026-08-01T02:00:00Z", 3),
      reading("e", "2026-08-01T01:00:00Z", 1),
      reading("e", "2026-08-01T03:00:00Z", 6),
    ]);
    expect(ordered[0]?.energy).toBeCloseTo(5, 9);
    expect(ordered[0]?.resets).toBe(0);
  });

  test("metrics are aggregated independently", () => {
    const rows = perDayEnergy([
      reading("a", "2026-08-01T01:00:00Z", 1),
      reading("b", "2026-08-01T01:00:00Z", 100),
      reading("a", "2026-08-01T02:00:00Z", 2),
      reading("b", "2026-08-01T02:00:00Z", 130),
    ]);
    expect(rows.map((r) => [r.metric, r.energy])).toEqual([
      ["a", 1],
      ["b", 30],
    ]);
  });

  test("a counter reset makes naive max-minus-min wrong by orders of magnitude", () => {
    const rows = perDayEnergy([
      reading("total_energy", "2026-08-01T10:00:00Z", 45_000),
      reading("total_energy", "2026-08-01T11:00:00Z", 45_001),
      reading("total_energy", "2026-08-01T12:00:00Z", 0),
      reading("total_energy", "2026-08-01T13:00:00Z", 1),
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.resets).toBe(1);
    expect(row.energy).toBeCloseTo(2, 9);
    expect(row.naive).toBeCloseTo(45_001, 9);
    expect(row.naive / row.energy).toBeGreaterThan(1000);
  });

  test("describeRestarts locates each reset and quantifies the naive error", () => {
    const restarts = describeRestarts([
      reading("total_energy", "2026-08-01T11:00:00Z", 45_001),
      reading("total_energy", "2026-08-01T12:00:00Z", 0),
      reading("day_energy", "2026-08-01T12:00:00Z", 3),
    ]);
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({
      metric: "total_energy",
      at: "2026-08-01T12:00:00.000Z",
      valueBefore: 45_001,
      valueAfter: 0,
    });
  });

  test("no reset means no restart rows — and that is reportable, not silent", () => {
    expect(describeRestarts([reading("e", "2026-08-01T01:00:00Z", 1)])).toEqual([]);
  });
});

describe("energyOf", () => {
  const rows = (values: number[]) =>
    values.map((value, index) => ({ time: new Date(Date.UTC(2026, 6, 28, 0, index)), value }));

  test("names the metric, runs both analyses, and normalizes the timestamps", () => {
    const result = energyOf("total_energy", rows([10, 20, 5, 15]));
    expect(result.energy).toEqual([
      { metric: "total_energy", day: "2026-07-28", energy: 25, naive: 15, resets: 1 },
    ]);
    expect(result.restarts).toEqual([
      {
        metric: "total_energy",
        at: "2026-07-28T00:02:00.000Z",
        valueBefore: 20,
        valueAfter: 5,
      },
    ]);
  });

  test("accepts Postgres' own text form, which is how a driver may hand it back", () => {
    const result = energyOf("m", [
      { time: "2026-07-28 00:00:00+00", value: 1 },
      { time: "2026-07-28 00:01:00+00", value: 3 },
    ]);
    expect(result.energy[0]?.energy).toBe(2);
    expect(result.energy[0]?.day).toBe("2026-07-28");
  });

  test("no rows means no days and no restarts, not a zero day", () => {
    expect(energyOf("m", [])).toEqual({ energy: [], restarts: [] });
  });

  test("a single reading has no step to attribute, so it contributes nothing", () => {
    expect(energyOf("m", rows([42]))).toEqual({ energy: [], restarts: [] });
  });
});
