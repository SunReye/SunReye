import { expect, test } from "bun:test";
import { costBands, split } from "./costs.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2027-01-01T00:00:00Z");

const EDGE = {
  key: "",
  label: "",
  tick: false,
  title: "",
  state: "past",
  drill: null,
  t0: 0,
  t1: 0,
} as const;

/** A day as the core states it, owing `standing` and nothing else. */
const owing = (start: number, hours: number, standing: number) => ({
  start: new Date(start).toISOString(),
  end: new Date(start + hours * HOUR).toISOString(),
  paid: 0,
  earned: 0,
  saved: 0,
  standing,
});

const down = (
  days: Parameters<typeof costBands>[0],
  spans: readonly (readonly [number, number])[],
) => spans.map((_, i) => costBands(days, spans, NOW)(EDGE, i).down);

test("the standing charge is a cost of its own beside the import bill, in no saving", () => {
  expect(split({ paid: 3, earned: 1, saved: 4, standing: 0.5 })).toEqual({
    up: [3, 1],
    down: [3, 0.5],
  });
});

test("a band across a month boundary holds each month's days at their own share", () => {
  // Berlin, 15 € a month: 0,50 € a day in November's 30 days; 31 € from December: 1 € a day.
  const first = Date.parse("2026-11-28T23:00:00Z");

  const days = [0.5, 0.5, 1, 1, 1].map((standing, i) => owing(first + i * 24 * HOUR, 24, standing));

  // 29 November to 2 December, then 3 December alone.
  const week = [first, first + 4 * 24 * HOUR] as const;
  const day = [week[1], week[1] + 24 * HOUR] as const;

  expect(down(days, [week, day])).toEqual([
    [0, 3],
    [0, 1],
  ]);
});

test("a month with a DST change sums to the whole charge, its long day to its real share", () => {
  // Berlin, October 2026: 745 hours, the 25th has 25 of them. 16 € a month.
  const first = Date.parse("2026-09-30T22:00:00Z");
  let start = first;

  const days = Array.from({ length: 31 }, (_, i) => {
    const hours = i === 24 ? 25 : 24;
    const day = owing(start, hours, (16 * hours) / 745);

    start += hours * HOUR;

    return day;
  });

  const long = Date.parse("2026-10-24T22:00:00Z");

  const [month, sunday] = down(days, [
    [first, start],
    [long, long + 25 * HOUR],
  ]);

  expect(start).toBe(Date.parse("2026-10-31T23:00:00Z"));
  expect(month![1]).toBeCloseTo(16, 9);
  expect(sunday![1]).toBeCloseTo((16 * 25) / 745, 9);
});
