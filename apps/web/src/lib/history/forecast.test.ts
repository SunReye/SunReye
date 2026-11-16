import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { edges } from "../range/edges.ts";
import { hourInstant, rangeFor, type Calendar } from "../range/range.ts";
import { NO_PLANT, sumOf, type Plant } from "./flows.ts";
import { forecastView } from "./forecast.ts";
import type { Rolled } from "./history.ts";
import type { Loaded } from "./stats.svelte.ts";

const ZONE = "UTC";
/** A Monday; today is the Tuesday after it, at noon. */
const MONDAY = dayOf(2026, 10, 2);
const CAL: Calendar = { today: MONDAY + 1, hour: 12, last: MONDAY + 1 };
const ms = (h: number) => hourInstant(ZONE, MONDAY * 24 + h).getTime();
const H = 3_600_000;

const day = (d: number, wh: number, read: number): Rolled => ({
  start: ms(d * 24),
  end: ms(d * 24 + 24),
  integral: wh,
  mean: wh / 24,
  max: null,
  covered: read * H,
});

/** Monday whole with 8 kWh, Tuesday 3 kWh by noon. */
const PLANT: Plant = {
  ...NO_PLANT,
  days: {
    ...NO_PLANT.days,
    pv: [day(0, 8000, 24), day(1, 3000, 12)],
    load: [day(0, 1, 24), day(1, 1, 12)],
  },
};

/** 10 kWh forecast on each of Monday, Tuesday and Wednesday, as 1 kW over ten hours. */
const TARGETS = [0, 1, 2].flatMap((d) => [
  { target: new Date(ms(d * 24 + 7)).toISOString(), value: 1000 },
  { target: new Date(ms(d * 24 + 17)).toISOString(), value: 0 },
]);

function loaded(): Loaded {
  const range = rangeFor("week", MONDAY);
  const list = edges(CAL, range);
  const none = sumOf(NO_PLANT, 0, 0);

  return {
    range,
    via: { id: 1, kind: "none", a: 0, b: 1, inward: true, dir: 0 },
    cal: CAL,
    zone: ZONE,
    list,
    spans: list.map((e) => [hourInstant(ZONE, e.t0).getTime(), hourInstant(ZONE, e.t1).getTime()]),
    now: ms(36),
    plant: PLANT,
    sum: sumOf(PLANT, ms(0), ms(168)),
    days: null,
    money: null,
    cmp: "prev",
    base: { range, hours: [0, 0], sum: none, money: null, plant: NO_PLANT, days: null },
  };
}

test("the range's sum is all that was measured against all that is forecast", () => {
  const view = forecastView(loaded(), TARGETS);

  expect(view.total.measured).toBeCloseTo(11);
  expect(view.total.forecast).toBeCloseTo(30);
});

test("accuracy judges whole past days alone", () => {
  const view = forecastView(loaded(), TARGETS);

  expect(view.accuracy.days).toBe(1);
  expect(view.accuracy.bias).toBeCloseTo(-0.2);
});
