import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { edges } from "../range/edges.ts";
import { track } from "../forecast/ahead.ts";
import { held } from "../forecast/forecast.ts";
import { calendar, customRange, hourInstant, rangeFor, type Calendar } from "../range/range.ts";
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
  { target: new Date(ms(d * 24)).toISOString(), value: 0 },
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

test("a past day and a year judge their whole past days, whatever their bands", () => {
  for (const kind of ["day", "year"] as const) {
    const range = rangeFor(kind, MONDAY);
    const list = edges(CAL, range);

    const view = forecastView(
      {
        ...loaded(),
        range,
        list,
        spans: list.map((e) => [
          hourInstant(ZONE, e.t0).getTime(),
          hourInstant(ZONE, e.t1).getTime(),
        ]),
      },
      TARGETS,
    );

    // Monday: 8 kWh against 10, by hours or inside November.
    expect(view.accuracy.days).toBe(1);
    expect(view.accuracy.error).toBeCloseTo(0.2);
    expect(view.accuracy.bias).toBeCloseTo(-0.2);
  }
});

/** 1.5 kW from 08:00 to 15:00, then 0.4 kW to 17:00: 11.3 kWh a day. */
const NOVEMBER = (h: number) => (h >= 8 && h < 15 ? 1500 : h >= 15 && h < 17 ? 400 : 0);

test("the tab judges the sheet's 30 days as the PV forecast sheet does", () => {
  // `NOVEMBER` from four days before today, the first stored target that first day's 15:00.
  // Each day read over its 9 daylight hours; today half its forecast so far.
  const now = ms(36);
  const cal = calendar(ZONE, new Date(now));
  const first = ms(24 - 4 * 24 + 15);

  const targets = Array.from({ length: (ms(48) - first) / H }, (_, i) => ({
    target: new Date(first + i * H).toISOString(),
    value: NOVEMBER((15 + i) % 24),
  }));

  const pv = [-3, -2, -1, 0, 1].map((d) => day(d, d === -3 ? 7872 : d === 1 ? 3000 : 11_300, 9));
  const range = customRange(cal, cal.today - 30, cal.today + 1);
  const list = edges(cal, range, "day");
  const load = pv.map((r) => ({ ...r, integral: 1 }));
  const plant: Plant = { ...NO_PLANT, days: { ...NO_PLANT.days, pv, load } };

  const view = forecastView(
    {
      ...loaded(),
      range,
      cal,
      list,
      spans: list.map((e) => [
        hourInstant(ZONE, e.t0).getTime(),
        hourInstant(ZONE, e.t1).getTime(),
      ]),
      now,
      plant,
    },
    targets,
  );

  const sheet = track(ZONE, now, pv, held(targets)).accuracy;

  // Today's 3 kWh against 6 forecast by noon count in neither.
  expect(view.accuracy).toEqual(sheet);
  expect(view.accuracy).toMatchObject({ error: 0, bias: 0, days: 3 });
});
