import { describe, expect, test } from "bun:test";
import type { PriceRow } from "$lib/prices/price-series";
import { dayCurves, historySince, historyWindows, nowBand } from "./price-history";

const QUARTER_MS = 900_000;
const DAY_MS = 86_400_000;

/** A row `i` quarter-hours after `date`T00:00 local. */
const row = (i: number, date = "2026-08-02"): PriceRow => {
  const startMs = new Date(`${date}T00:00:00`).getTime() + i * QUARTER_MS;
  const minutes = i * 15;
  const label = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return {
    key: `${date}T${label}`,
    label,
    startMs,
    ctPerKwh: 5,
    positiveCt: 5,
    negativeCt: 0,
    negative: false,
    dayStart: i === 0,
  };
};

describe("historySince", () => {
  test("takes the trailing window of the picked range", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-07-01T00:00:00Z");
    expect(historySince(from, to, 30)).toBe(to.getTime() - 30 * DAY_MS);
  });

  test("never reaches back past the picked range", () => {
    const from = new Date("2026-06-25T00:00:00Z");
    const to = new Date("2026-07-01T00:00:00Z");
    expect(historySince(from, to, 90)).toBe(from.getTime());
  });
});

describe("historyWindows", () => {
  const window = (start: string, end: string, minEurPerMwh = -12.5, slots = 2) => ({
    start,
    end,
    minEurPerMwh,
    slots,
  });

  test("converts instants and prices to the panel's market-local ct/kWh shape", () => {
    const start = "2026-08-02T13:00:00Z";
    const end = "2026-08-02T14:30:00Z";
    const [w] = historyWindows([window(start, end)], 0, 0);
    expect(w).toEqual({
      startMs: Date.parse(start),
      endMs: Date.parse(end),
      from: "13:00",
      to: "14:30",
      date: "2026-08-02",
      slots: 2,
      minCtPerKwh: -1.25,
    });
  });

  test("reads the clock in the market's zone, not the viewer's", () => {
    // 22:30Z is 00:30 the next day in CEST — the day header has to move too.
    const [w] = historyWindows([window("2026-08-02T22:30:00Z", "2026-08-02T23:30:00Z")], 0, 7200);
    expect(w?.from).toBe("00:30");
    expect(w?.to).toBe("01:30");
    expect(w?.date).toBe("2026-08-03");
  });

  test("drops windows that start before the history cut-off", () => {
    const older = window("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z");
    const newer = window("2026-07-20T10:00:00Z", "2026-07-20T11:00:00Z");
    const since = Date.parse("2026-07-01T00:00:00Z");
    expect(historyWindows([older, newer], since, 0).map((w) => w.startMs)).toEqual([
      Date.parse(newer.start),
    ]);
  });
});

describe("dayCurves", () => {
  test("splits today from tomorrow, keeping order", () => {
    const curves = dayCurves([row(0), row(1), row(0, "2026-08-03")]);
    expect(curves.map((c) => c.date)).toEqual(["2026-08-02", "2026-08-03"]);
    expect(curves[0]?.rows).toHaveLength(2);
  });

  test("has no curve at all for an empty series", () => {
    expect(dayCurves([])).toEqual([]);
  });
});

describe("nowBand", () => {
  const rows = [row(0), row(1), row(2)];

  test("marks the slot the instant falls in", () => {
    expect(nowBand(rows, rows[1]!.startMs + 60_000)).toBe("00:15");
  });

  test("marks nothing outside the curve", () => {
    expect(nowBand(rows, rows[0]!.startMs - 1)).toBeNull();
    expect(nowBand(rows, rows[2]!.startMs + QUARTER_MS)).toBeNull();
    expect(nowBand([], Date.now())).toBeNull();
  });
});
