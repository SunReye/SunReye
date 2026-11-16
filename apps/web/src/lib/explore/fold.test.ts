import { expect, test } from "bun:test";
import { rangeFor, type Range } from "../range/range.ts";
import { dayOfIso } from "../range/calendar.ts";
import {
  columnsOf,
  energyOf,
  figure,
  foldOf,
  isCounter,
  labelOf,
  periodOf,
  periodsOf,
  rowsOf,
  foldScale,
  sorted,
  totalOf,
  type Column,
} from "./fold.ts";

const DAY = dayOfIso("2026-11-15");

const by = (period: string | null) => new URLSearchParams(period === null ? "" : `by=${period}`);

test("a day folds by hour, a week or month by day and a year by month", () => {
  expect(periodsOf(rangeFor("day", DAY)).initial).toBe("hour");
  expect(periodsOf(rangeFor("week", DAY)).initial).toBe("day");
  expect(periodsOf(rangeFor("month", DAY)).initial).toBe("day");
  expect(periodsOf(rangeFor("year", DAY)).initial).toBe("month");
});

test("a range offers the periods it holds several of, hours only while one read serves them", () => {
  expect(periodsOf(rangeFor("day", DAY)).offered).toEqual(["hour"]);
  expect(periodsOf(rangeFor("week", DAY)).offered).toEqual(["hour", "day"]);
  expect(periodsOf(rangeFor("month", DAY)).offered).toEqual(["hour", "day", "week"]);
  // A year's hours are past the hour tier's cap (ADR 9).
  expect(periodsOf(rangeFor("year", DAY)).offered).toEqual(["day", "week", "month"]);
});

const custom = (days: number): Range => ({ kind: "custom", from: DAY - days, to: DAY });

test("a custom range folds by its grain, and three years by month", () => {
  expect(periodsOf(custom(30)).initial).toBe("day");
  expect(periodsOf(custom(120)).initial).toBe("week");
  expect(periodsOf(custom(1200)).initial).toBe("month");
});

test("the route's period is taken while the range offers it", () => {
  expect(periodOf(rangeFor("month", DAY), by("week"))).toBe("week");
  expect(periodOf(rangeFor("month", DAY), by(null))).toBe("day");
  // A day holds no weeks, and a year too many hours.
  expect(periodOf(rangeFor("day", DAY), by("week"))).toBe("hour");
  expect(periodOf(rangeFor("year", DAY), by("hour"))).toBe("month");
  expect(periodOf(rangeFor("year", DAY), by("decade"))).toBe("month");
});

const point = (date: string, figures: Readonly<Record<string, number>>) => ({
  date,
  start: `${date}T00:00:00Z`,
  end: `${date}T23:00:00Z`,
  ...figures,
});

const MEASURED = [
  point("2026-11-01", { mean: 400, min: 0, max: 3000, integral: 9600, hours: 24 }),
  point("2026-11-02", { mean: 100, min: -50, max: 900, integral: 1200, hours: 12 }),
  point("2026-11-04", { mean: 250, min: 10, max: 4000, integral: 6000, hours: 24 }),
];

test("a period's figures become a row, its energy the statistics' integral", () => {
  expect(rowsOf(MEASURED)[1]).toEqual({
    key: "2026-11-02T00:00:00Z",
    start: Date.parse("2026-11-02T00:00:00Z"),
    end: Date.parse("2026-11-02T23:00:00Z"),
    day: dayOfIso("2026-11-02"),
    mean: 100,
    min: -50,
    max: 900,
    energy: 1200,
    delta: null,
    hours: 12,
  });
});

/** The days of the month in the table's order. */
const dates = (column: Column, dir: "asc" | "desc") =>
  sorted(rowsOf(MEASURED), column, dir).map((row) => row.key.slice(8, 10));

test("the table sorts by each column, either way", () => {
  expect(dates("period", "desc")).toEqual(["04", "02", "01"]);
  expect(dates("mean", "asc")).toEqual(["02", "04", "01"]);
  expect(dates("min", "desc")).toEqual(["04", "01", "02"]);
  expect(dates("max", "desc")).toEqual(["04", "01", "02"]);
  expect(dates("energy", "asc")).toEqual(["02", "04", "01"]);
  expect(dates("hours", "asc")).toEqual(["02", "01", "04"]);
});

test("a period without a figure sorts last, either way", () => {
  const rows = rowsOf([
    point("2026-11-01", { delta: 5 }),
    point("2026-11-02", {}),
    point("2026-11-03", { delta: 9 }),
  ]);

  const days = (dir: "asc" | "desc") => sorted(rows, "delta", dir).map((r) => r.key.slice(8, 10));

  expect(days("asc")).toEqual(["01", "03", "02"]);
  expect(days("desc")).toEqual(["03", "01", "02"]);
});

test("a counter shows its delta alone; a measurement its energy only in a unit that has one", () => {
  expect(columnsOf(true, "kWh")).toEqual(["period", "delta"]);
  expect(columnsOf(false, "W")).toEqual(["period", "mean", "min", "max", "energy", "hours"]);
  expect(columnsOf(false, "°C")).toEqual(["period", "mean", "min", "max", "hours"]);
});

test("a power's energy is written in kWh and a cost rate's in EUR", () => {
  expect(energyOf("W")).toEqual({ unit: "kWh", per: 1000 });
  expect(energyOf("kW")).toEqual({ unit: "kWh", per: 1 });
  expect(energyOf("EUR/h")).toEqual({ unit: "EUR", per: 1 });
  expect(energyOf("V")).toBeNull();
  expect(energyOf(null)).toBeNull();
});

test("a series is a counter by its kind, and an extra stored before kinds by its deltas", () => {
  expect(isCounter("counter", [])).toBe(true);
  expect(isCounter("measurement", MEASURED)).toBe(false);
  expect(isCounter(null, [point("2026-11-01", { delta: 5 })])).toBe(true);
  expect(isCounter(null, MEASURED)).toBe(false);
});

test("the range's figures: the mean over the hours with a value, the extremes and the sums", () => {
  expect(totalOf(rowsOf(MEASURED))).toEqual({
    mean: (400 * 24 + 100 * 12 + 250 * 24) / 60,
    min: -50,
    max: 4000,
    energy: 16_800,
    delta: null,
    hours: 60,
  });
  expect(
    totalOf(rowsOf([point("2026-11-01", { delta: 5 }), point("2026-11-03", { delta: 9 })])),
  ).toMatchObject({ delta: 14, mean: null, energy: null });
});

test("the chart's scale holds the whiskers on both sides of zero", () => {
  expect(foldScale(rowsOf(MEASURED), false)).toMatchObject({ upMax: 5000, downMax: 60 });
  expect(foldScale(rowsOf([point("2026-11-01", { delta: 14 })]), true)).toMatchObject({
    upMax: 15,
    downMax: 0,
  });
});

test("a period is named by its plant-local date", () => {
  const [row] = rowsOf([
    { date: "2026-11-02", start: "2026-11-02T13:00:00Z", end: "2026-11-02T14:00:00Z", mean: 1 },
  ]);

  expect(labelOf(row!, "month", "UTC")).toBe("November 2026");
  expect(labelOf(row!, "week", "UTC")).toBe("KW 45 · ab 2. Nov.");
  expect(labelOf(row!, "day", "UTC")).toBe("Mo., 2. November");
  expect(labelOf(row!, "hour", "Europe/Berlin")).toBe("2. Nov. · 14:00–15:00 Uhr");
});

test("a status or held value has no fold, and an unlisted series nothing stored", () => {
  const first = "2026-01-01T00:00:00Z";

  expect(foldOf({ kind: "status", first }, "ready")).toBe("none");
  expect(foldOf({ kind: "held", first }, "ready")).toBe("none");
  expect(foldOf({ kind: "measurement", first }, "ready")).toBe("read");
  expect(foldOf({ kind: "counter", first }, "ready")).toBe("read");
  // An extra stored before kinds: its statistics say what it is.
  expect(foldOf({ kind: null, first }, "ready")).toBe("read");
  expect(foldOf({ kind: null, first: null }, "ready")).toBe("unstored");
  expect(foldOf({ kind: null, first: null }, "loading")).toBe("pending");
  expect(foldOf({ kind: null, first: null }, "failed")).toBe("read");
});

test("a figure is written to three places at most", () => {
  expect(figure(3000)).toBe("3.000");
  expect(figure(12.54)).toBe("12,5");
  expect(figure(9.6)).toBe("9,6");
  expect(figure(0.126)).toBe("0,13");
  expect(figure(0)).toBe("0");
  expect(figure(null)).toBe("–");
});
