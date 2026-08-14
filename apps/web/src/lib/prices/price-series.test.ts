import { describe, expect, test } from "bun:test";
import type { SpotPriceView } from "server/src/prices/spot-price-job";
import { ctLabel, negativeHours, priceRows } from "./price-series";

const QUARTER_MS = 900_000;
const BASE = Date.parse("2026-08-01T22:00:00Z"); // 2026-08-02T00:00 CEST

/** A slot `i` quarter-hours after midnight local, at `eurPerMwh`. */
const slot = (i: number, eurPerMwh: number, date = "2026-08-02") => {
  const minutes = i * 15;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return {
    time: `${date}T${hh}:${mm}`,
    startMs: BASE + i * QUARTER_MS,
    minutes: 15,
    eurPerMwh,
    negative: eurPerMwh < 0,
    // Priced by the server under the active tariff; the shaping here doesn't read
    // them, but the fixture has to be a real slot.
    importPerKwh: 0.35,
    exportPerKwh: eurPerMwh < 0 ? 0 : 0.0794,
  };
};

const view = (series: SpotPriceView["series"]): SpotPriceView => ({
  provider: "energy-charts",
  zone: "DE-LU",
  attribution: "test",
  resolutionMinutes: 15,
  utcOffsetSeconds: 7200,
  coverage: { today: "complete", tomorrow: "complete" },
  availability: "ok",
  series,
  extremes: null,
  negativeSlots: { today: 0, tomorrow: 0 },
});

describe("priceRows", () => {
  test("splits each band into exactly one diverging half", () => {
    // Also pins the EUR/MWh → ct/kWh conversion (÷10, sign preserved).
    const rows = priceRows(view([slot(0, 120), slot(1, -30), slot(2, 0)]));
    expect(rows.map((r) => r.ctPerKwh)).toEqual([12, -3, 0]);
    expect(rows.map((r) => r.positiveCt)).toEqual([12, 0, 0]);
    expect(rows.map((r) => r.negativeCt)).toEqual([0, -3, 0]);
    // A slot at exactly zero is neither half, and is not negative.
    expect(rows[2]?.negative).toBe(false);
  });

  test("only the first band of a day carries its date", () => {
    const rows = priceRows(
      view([slot(0, 10), slot(1, 10), slot(0, 10, "2026-08-03"), slot(1, 10, "2026-08-03")]),
    );
    expect(rows.map((r) => r.label)).toEqual(["08-02 00:00", "00:15", "08-03 00:00", "00:15"]);
    expect(rows.map((r) => r.dayStart)).toEqual([true, false, true, false]);
  });

  test("keys are unique across both days so bands cannot collide", () => {
    const rows = priceRows(view([slot(4, 10), slot(4, 20, "2026-08-03")]));
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe("negativeHours", () => {
  test("sums window durations", () => {
    const half = (i: number, hours: number) => ({
      startMs: BASE + i * QUARTER_MS,
      endMs: BASE + i * QUARTER_MS + hours * 3_600_000,
      from: "00:00",
      to: "00:30",
      date: "2026-08-02",
      slots: 2,
      minCtPerKwh: -0.1,
    });
    expect(negativeHours([half(0, 0.5), half(12, 0.5)])).toBeCloseTo(1, 6);
  });
});

describe("ctLabel", () => {
  test("always shows two decimals with the unit", () => {
    expect(ctLabel(-3)).toBe("-3.00 ct");
    expect(ctLabel(8.4249)).toBe("8.42 ct");
  });
});
