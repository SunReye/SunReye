import { describe, expect, test } from "bun:test";
import type { SpotPriceView } from "server/src/prices/spot-price-job";
import {
  type BandScale,
  bandSpan,
  ctLabel,
  negativeBandRuns,
  negativeHours,
  priceRows,
} from "./price-series";

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

describe("negativeBandRuns", () => {
  /** The bands of one curve, at `eurPerMwh` each, oldest first. */
  const bands = (...prices: number[]) => priceRows(view(prices.map((p, i) => slot(i, p))));

  test("a day that never goes negative shades nothing", () => {
    expect(negativeBandRuns(bands(120, 80, 0, 40))).toEqual([]);
    expect(negativeBandRuns([])).toEqual([]);
  });

  test("a single negative quarter-hour is its own run", () => {
    // The §51 case that started this: one quarter at −0.5 ct inside an otherwise
    // ordinary day. It is a hairline on the axis, so it has to be shaded.
    expect(negativeBandRuns(bands(120, -5, 80))).toEqual([{ first: "00:15", last: "00:15" }]);
  });

  test("adjacent negative quarter-hours merge into one window", () => {
    expect(negativeBandRuns(bands(20, -5, -30, -12, 20))).toEqual([
      { first: "00:15", last: "00:45" },
    ]);
  });

  test("a positive band between two dips splits them into two windows", () => {
    expect(negativeBandRuns(bands(-5, -8, 15, -3, -9))).toEqual([
      { first: "08-02 00:00", last: "00:15" },
      { first: "00:45", last: "01:00" },
    ]);
  });

  test("a slot at exactly zero closes the window — free is not paid-for", () => {
    // 0.00 EUR/MWh clears at auction; the server flags it not-negative, and the
    // shading has to follow that flag rather than `ct <= 0`.
    expect(negativeBandRuns(bands(-5, 0, -8))).toEqual([
      { first: "08-02 00:00", last: "08-02 00:00" },
      { first: "00:30", last: "00:30" },
    ]);
  });

  test("a window open at the first band and one open at the last both close", () => {
    expect(negativeBandRuns(bands(-5, -6, 30, -7, -8))).toHaveLength(2);
    expect(negativeBandRuns(bands(-5, -6, -7))).toEqual([{ first: "08-02 00:00", last: "00:30" }]);
  });

  test("a window running over midnight stays one window", () => {
    // Both days come back in one view; the run is a market fact, not a
    // per-calendar-day one, and the label of its last band carries the new date.
    const rows = priceRows(
      view([
        slot(94, 40),
        slot(95, -5, "2026-08-02"),
        slot(0, -9, "2026-08-03"),
        slot(1, -2, "2026-08-03"),
        slot(2, 30, "2026-08-03"),
      ]),
    );
    expect(negativeBandRuns(rows)).toEqual([{ first: "23:45", last: "00:15" }]);
  });
});

describe("bandSpan", () => {
  /** A layerchart band scale, as much of one as the shading maths reads. */
  const band = (labels: string[], width: number): BandScale => {
    const scale = ((label: string) => {
      const i = labels.indexOf(label);
      return i === -1 ? undefined : i * width;
    }) as BandScale;
    scale.bandwidth = () => width;
    return scale;
  };

  const axis = band(["00:00", "00:15", "00:30", "00:45"], 20);

  test("a one-band window is shaded across that band's own width", () => {
    expect(bandSpan(axis, { first: "00:15", last: "00:15" })).toEqual({ x: 20, width: 20 });
  });

  test("a multi-band window reaches the far edge of its last band", () => {
    // Not the last band's left edge: the run includes that quarter-hour.
    expect(bandSpan(axis, { first: "00:15", last: "00:45" })).toEqual({ x: 20, width: 60 });
  });

  test("a scale with no bandwidth still leaves a visible hairline", () => {
    // A point scale reports no bandwidth; a zero-width Rect would drop the one
    // thing the shading exists to show.
    const points = ((label: string) => ["00:00", "00:15"].indexOf(label) * 30) as BandScale;
    expect(bandSpan(points, { first: "00:15", last: "00:15" })).toEqual({ x: 30, width: 1 });
  });

  test("a band that is no longer on the axis never yields NaN or a negative width", () => {
    // Rows and scale are separate reactive reads: for one frame after the day
    // turns over, a run can name a band the axis has already dropped. A Rect
    // with a NaN or negative width takes the canvas down.
    const gone = bandSpan(axis, { first: "23:45", last: "23:45" });
    expect(gone).toEqual({ x: 0, width: 20 });
    const halfGone = bandSpan(axis, { first: "00:45", last: "23:45" });
    expect(Number.isFinite(halfGone.x)).toBe(true);
    expect(halfGone.width).toBeGreaterThanOrEqual(1);
  });
});

describe("priceRows on a daylight-saving fall-back day", () => {
  test("the repeated wall-clock hour still advances in real time", () => {
    // 2026-10-25 in DE-LU: 02:00 CEST (00:00Z) is followed an hour later by
    // 02:00 CET (01:00Z). The market-local label is genuinely the same string
    // for both, so the band identity has to come from `startMs` — anything
    // derived from `time` collapses the two hours onto one another.
    const cest = Date.parse("2026-10-25T00:00:00Z");
    const repeated = (offsetMs: number, eurPerMwh: number) => ({
      time: "2026-10-25T02:00",
      startMs: cest + offsetMs,
      minutes: 60,
      eurPerMwh,
      negative: eurPerMwh < 0,
      importPerKwh: 0.35,
      exportPerKwh: 0,
    });
    const rows = priceRows(view([repeated(0, 30), repeated(3_600_000, -20)]));
    expect(rows.map((r) => r.startMs)).toEqual([cest, cest + 3_600_000]);
    expect(rows[1]!.startMs - rows[0]!.startMs).toBe(3_600_000);
    // Only the first band of the market-local day carries its date.
    expect(rows.map((r) => r.dayStart)).toEqual([true, false]);
    expect(rows.map((r) => r.negativeCt)).toEqual([0, -2]);
  });
});
