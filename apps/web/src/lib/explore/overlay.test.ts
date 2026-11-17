import { expect, test } from "bun:test";
import { dayOfIso, iso } from "../range/calendar.ts";
import { rangeFor, type Range } from "../range/range.ts";
import type { Curve } from "./curve.ts";
import {
  added,
  aligned,
  overlayRange,
  periodsOf,
  picksOf,
  removed,
  spanOf,
  tintOf,
} from "./overlay.ts";

const ZONE = "Europe/Berlin";
const HOUR = 3_600_000;
const at = (text: string) => Date.parse(text);
const day = (text: string) => rangeFor("day", dayOfIso(text));
const week = (text: string) => rangeFor("week", dayOfIso(text));

/** One sample per hour from `from` to `to`, valued by its place. */
function hourly(from: string, to: string): Curve {
  const samples = [];

  for (let t = at(from); t < at(to); t += HOUR)
    samples.push({ t0: t, t1: t + HOUR, v: samples.length });

  return { draw: "line", tier: "bucket", samples };
}

const hoursIn = (curve: Curve, onto: number) =>
  curve.samples.map((s) => [(s.t0 - onto) / HOUR, s.v]);

test("the range comes first, then the picked periods from the latest back", () => {
  const got = periodsOf(ZONE, day("2026-11-16"), ["2026-11-09", "2026-11-15"]);

  expect(got.map((p) => p.key)).toEqual(["2026-11-16", "2026-11-15", "2026-11-09"]);
  // Each from its plant-local midnight to the next: 23:00Z in winter.
  expect(got[1]).toMatchObject({ from: at("2026-11-14T23:00Z"), to: at("2026-11-15T23:00Z") });
});

test("a period picked twice, or the range's own, is one period", () => {
  const got = periodsOf(ZONE, day("2026-11-16"), ["2026-11-15", "2026-11-16", "2026-11-15"]);

  expect(got.map((p) => p.key)).toEqual(["2026-11-16", "2026-11-15"]);
});

test("a chart holds the range and four more periods", () => {
  const picked = ["2026-11-15", "2026-11-14", "2026-11-13", "2026-11-12", "2026-11-11"];
  const got = periodsOf(ZONE, day("2026-11-16"), picked);

  expect(got.map((p) => p.key)).toEqual([
    "2026-11-16",
    "2026-11-15",
    "2026-11-14",
    "2026-11-13",
    "2026-11-12",
  ]);
});

test("in a week a picked day stands for its week, Monday to Sunday", () => {
  const got = periodsOf(ZONE, week("2026-11-16"), ["2026-11-12", "2026-11-10", "2026-11-18"]);

  // The 12th and the 10th are one week; the 18th lies in the range's own.
  expect(got.map((p) => p.key)).toEqual(["2026-11-16", "2026-11-09"]);
  expect(got[1]).toMatchObject({ from: at("2026-11-08T23:00Z"), to: at("2026-11-15T23:00Z") });
});

test("a day before the clocks go forward aligns on its midnight, and the short day ends early", () => {
  // 2026-03-29 has 23 hours in Berlin: 02:00 to 03:00 is skipped.
  const [range, short] = periodsOf(ZONE, day("2026-03-30"), ["2026-03-29"]);

  expect((short!.to - short!.from) / HOUR).toBe(23);
  expect(spanOf([range!, short!]) / HOUR).toBe(24);

  const drawn = aligned(hourly("2026-03-28T23:00Z", "2026-03-29T22:00Z"), short!, range!.from);

  // Its hours run on unbroken from the range's midnight, and stop an hour short of its end.
  expect(hoursIn(drawn, range!.from)).toEqual(Array.from({ length: 23 }, (_, i) => [i, i]));
  expect(drawn.samples.at(-1)!.t1).toBe(range!.to - HOUR);
});

test("a day the clocks go back plots its repeated hour twice, in order, on a longer axis", () => {
  // 2026-10-25 has 25 hours in Berlin: 02:00 to 03:00 comes twice.
  const [range, long] = periodsOf(ZONE, day("2026-10-26"), ["2026-10-25"]);

  expect((long!.to - long!.from) / HOUR).toBe(25);
  // The axis runs as long as the longest period, so the 25th hour is drawn.
  expect(spanOf([range!, long!]) / HOUR).toBe(25);

  const drawn = aligned(hourly("2026-10-24T22:00Z", "2026-10-25T23:00Z"), long!, range!.from);
  const hours = hoursIn(drawn, range!.from);

  // 02:00 CEST (00:00Z) then 02:00 CET (01:00Z): the third and the fourth hour of the day.
  expect(hours.slice(2, 4)).toEqual([
    [2, 2],
    [3, 3],
  ]);
  expect(hours).toHaveLength(25);
  expect(hours.at(-1)).toEqual([24, 24]);
});

test("a short and a long day under a range of either keep their own lengths", () => {
  const periods = periodsOf(ZONE, day("2026-10-25"), ["2026-03-29", "2026-10-24"]);

  expect(periods.map((p) => (p.to - p.from) / HOUR)).toEqual([25, 24, 23]);
  expect(spanOf(periods) / HOUR).toBe(25);
});

test("weeks align on their Mondays, across a change of the clocks", () => {
  // The week of 2026-10-19 ends on the 25-hour Sunday.
  const [range, long] = periodsOf(ZONE, week("2026-10-26"), ["2026-10-20"]);

  expect((long!.to - long!.from) / HOUR).toBe(169);
  expect(spanOf([range!, long!]) / HOUR).toBe(169);

  const drawn = aligned(hourly("2026-10-18T22:00Z", "2026-10-25T23:00Z"), long!, range!.from);

  // Monday 00:00 CEST on Monday 00:00 CET.
  expect(drawn.samples[0]!.t0).toBe(at("2026-10-25T23:00Z"));
  expect(drawn.samples).toHaveLength(169);
});

test("an aligned statistic keeps its extremes", () => {
  const [range, before] = periodsOf(ZONE, day("2026-11-16"), ["2026-11-15"]);
  const t0 = at("2026-11-15T10:00Z");

  const curve: Curve = {
    draw: "line",
    tier: "hour",
    samples: [{ t0, t1: t0 + HOUR, v: 2, lo: 1, hi: 3 }],
  };

  expect(aligned(curve, before!, range!.from).samples).toEqual([
    { t0: t0 + 24 * HOUR, t1: t0 + 25 * HOUR, v: 2, lo: 1, hi: 3 },
  ]);
});

test("a day offers the day before, the week before and the same day last year, as offsets", () => {
  expect(picksOf(day("2026-11-16"))).toEqual([
    { id: "day", entry: "-1d" },
    { id: "week", entry: "-1w" },
    { id: "year", entry: "-1y" },
  ]);
});

test("a week offers the week before and the same week last year, as offsets", () => {
  expect(picksOf(week("2026-11-16"))).toEqual([
    { id: "week", entry: "-1w" },
    { id: "year", entry: "-1y" },
  ]);
});

const keysOf = (r: Range, picked: readonly string[]) =>
  periodsOf(ZONE, r, picked).map((p) => p.key);

test("a day's offsets resolve against the range in force", () => {
  expect(keysOf(day("2026-11-16"), ["-1d", "-1w", "-1y"])).toEqual([
    "2026-11-16",
    "2026-11-15",
    "2026-11-09",
    "2025-11-16",
  ]);
  // The same route a day later compares that day.
  expect(keysOf(day("2026-11-17"), ["-1d", "-1w", "-1y"])).toEqual([
    "2026-11-17",
    "2026-11-16",
    "2026-11-10",
    "2025-11-17",
  ]);
});

test("a week's offsets are the week before and the same ISO week last year", () => {
  expect(keysOf(week("2026-11-16"), ["-1w", "-1y"])).toEqual([
    "2026-11-16",
    "2026-11-09",
    "2025-11-17",
  ]);
  // Week 1 of 2027 against week 1 of 2026, which begins in 2025.
  expect(keysOf(week("2027-01-04"), ["-1w", "-1y"])).toEqual([
    "2027-01-04",
    "2026-12-28",
    "2025-12-29",
  ]);
  // Week 53 of 2026: 2025 has none, so its last week stands in.
  expect(keysOf(week("2026-12-28"), ["-1w", "-1y"])).toEqual([
    "2026-12-28",
    "2026-12-21",
    "2025-12-22",
  ]);
});

test("an offset and a date of one period are one period", () => {
  const got = periodsOf(ZONE, day("2026-11-16"), ["-1d", "2026-11-15"]);

  expect(got.map((p) => p.key)).toEqual(["2026-11-16", "2026-11-15"]);
  expect(added(day("2026-11-16"), ["2026-11-15"], "-1d")).toBeNull();
  expect(added(day("2026-11-16"), ["2026-11-09"], "-1d")).toEqual(["2026-11-09", "-1d"]);
});

test("removing a period removes the offset that names it", () => {
  const range = day("2026-11-16");
  const [, before] = periodsOf(ZONE, range, ["-1d", "-1w"]);

  expect(removed(range, ["-1d", "-1w", "2026-11-15"], before!)).toEqual(["-1w"]);
});

test("a picked period joins the others once, and never past four", () => {
  const range = day("2026-11-16");

  expect(added(range, ["2026-11-15"], "2026-11-09")).toEqual(["2026-11-15", "2026-11-09"]);
  expect(added(range, ["2026-11-15"], "2026-11-15")).toBeNull();
  // The range's own day is no earlier period.
  expect(added(range, [], "2026-11-16")).toBeNull();
  expect(
    added(range, ["2026-11-15", "2026-11-14", "2026-11-13", "2026-11-12"], "2026-11-11"),
  ).toBeNull();
});

test("removing a week removes every day picked in it", () => {
  const range = week("2026-11-16");
  const [, before] = periodsOf(ZONE, range, ["2026-11-12", "2026-11-10", "2026-11-03"]);

  expect(before!.key).toBe("2026-11-09");
  expect(removed(range, ["2026-11-12", "2026-11-10", "2026-11-03"], before!)).toEqual([
    "2026-11-03",
  ]);
});

const D16 = dayOfIso("2026-11-16");
const cal = { today: D16, hour: 9, last: D16 };

test("a day or a week stays the overlay's range", () => {
  const r = week("2026-11-03");

  expect(overlayRange(cal, r)).toBe(r);
});

test("a longer range that holds today opens today", () => {
  expect(overlayRange(cal, rangeFor("month", D16))).toEqual(day("2026-11-16"));
});

test("a longer range in the past opens its last day", () => {
  const custom: Range = {
    kind: "custom",
    from: dayOfIso("2026-10-01"),
    to: dayOfIso("2026-10-08"),
  };

  expect(iso(overlayRange(cal, rangeFor("month", dayOfIso("2026-09-10"))).from)).toBe("2026-09-30");
  expect(overlayRange(cal, custom)).toEqual(day("2026-10-07"));
});

test("the range draws in the series' colour, earlier periods in receding tints of it", () => {
  const tints = [0, 1, 2, 3, 4].map((i) => tintOf("var(--flow-solar)", i));

  expect(tints[0]).toBe("var(--flow-solar)");
  expect(tints[1]).toBe("color-mix(in oklab, var(--flow-solar) 60%, transparent)");
  expect(new Set(tints).size).toBe(5);
});
