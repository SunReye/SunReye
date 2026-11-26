import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { rangeFor, type Calendar } from "../range/range.ts";
import { baselineOf } from "./compare.ts";

const TODAY = dayOf(2026, 10, 12);
const CAL: Calendar = { today: TODAY, hour: 15, last: TODAY };

test("the previous period is the step before; last year is the same dates a year earlier", () => {
  const nov = rangeFor("month", dayOf(2026, 9, 3));

  expect(baselineOf(CAL, nov, "prev").range).toMatchObject({ from: dayOf(2026, 8, 1) });
  expect(baselineOf(CAL, nov, "year").range).toMatchObject({
    kind: "month",
    from: dayOf(2025, 9, 1),
    to: dayOf(2025, 10, 1),
  });
  expect(baselineOf(CAL, rangeFor("week", TODAY), "year").range.from).toBe(
    rangeFor("week", TODAY).from - 364,
  );
});

test("a running range is compared over the same elapsed time", () => {
  const month = rangeFor("month", TODAY);
  const base = baselineOf(CAL, month, "prev");

  // 11 days and 15 hours into November; October as far.
  expect(base.hours).toEqual([dayOf(2026, 9, 1) * 24, dayOf(2026, 9, 12) * 24 + 15]);
  expect(baselineOf(CAL, rangeFor("month", dayOf(2026, 9, 3)), "prev").hours).toEqual([
    dayOf(2026, 8, 1) * 24,
    dayOf(2026, 9, 1) * 24,
  ]);
});

test("a year always compares with the year before", () => {
  expect(baselineOf(CAL, rangeFor("year", TODAY), "prev").range).toEqual(
    rangeFor("year", dayOf(2025, 0, 1)),
  );
});
