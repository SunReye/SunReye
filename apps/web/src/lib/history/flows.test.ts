import { expect, test } from "bun:test";
import type { Rolled } from "./history.ts";
import { gapsOf, hourSum, NO_PLANT, sumOf, type Plant } from "./flows.ts";

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.parse("2026-11-03T00:00:00Z");

/** Rollups of `length` ms from T0 on, one per Wh figure, each read whole. */
const rolled =
  (length: number) =>
  (...whs: readonly number[]): Rolled[] =>
    whs.map((wh, i) => ({
      start: T0 + i * length,
      end: T0 + (i + 1) * length,
      integral: wh,
      mean: (wh * H) / length,
      covered: length,
    }));

const [days, hours] = [rolled(DAY), rolled(H)];

/** Two days' rollups, and four hours': sun and export, then dark and import. */
const PLANT: Plant = {
  ...NO_PLANT,
  days: {
    ...NO_PLANT.days,
    pv: days(4000, 6000),
    load: days(4000, 5000),
    imported: days(2000, 1000),
    exported: days(2000, 2000),
    selfUsed: days(2000, 4000),
    selfCovered: days(2000, 4000),
  },
  hours: {
    ...NO_PLANT.hours,
    pv: hours(2000, 2000, 0, 0),
    load: hours(1000, 1000, 1000, 1000),
    imported: hours(0, 0, 1000, 1000),
    exported: hours(1000, 1000, 0, 0),
    selfUsed: hours(1000, 1000, 0, 0),
    selfCovered: hours(1000, 1000, 0, 0),
  },
};

test("a range balances: production is self-used plus fed in, consumption self-covered plus bought", () => {
  const s = sumOf(PLANT, T0, T0 + DAY);

  expect(s).toMatchObject({ production: 4, feedIn: 2, selfUsed: 2, consumption: 4 });
  expect(s).toMatchObject({ purchase: 2, selfCovered: 2, autarky: 50, selfUse: 50 });
  expect(s.selfUsed + s.feedIn).toBe(s.production);
  expect(s.selfCovered + s.purchase).toBe(s.consumption);
});

test("a span sums the day rollups starting in it, the open day's to its latest reading", () => {
  expect(sumOf(PLANT, T0, T0 + 2 * DAY)).toMatchObject({ production: 10, consumption: 9 });
  expect(sumOf(PLANT, T0 + DAY, T0 + DAY + 15 * H)).toMatchObject({
    production: 6,
    purchase: 1,
    autarky: 80,
  });
});

test("a band of hours sums the hourly rollups starting in it", () => {
  expect(hourSum(PLANT, T0 + 1 * H, T0 + 3 * H)).toMatchObject({
    production: 2,
    consumption: 2,
    feedIn: 1,
    purchase: 1,
  });
});

test("the battery's charge and discharge are its own rollups, and the car counts apart", () => {
  // A day that charged 3 kWh and gave 1.5 kWh nets 1.5 kWh: both ways still show.
  const plant: Plant = {
    ...PLANT,
    days: { ...PLANT.days, charge: days(3000), discharge: days(1500), ev: days(3000) },
    hours: { ...PLANT.hours, charge: hours(500, 0), discharge: hours(0, 1500), ev: hours(0, 3000) },
  };

  expect(sumOf(plant, T0, T0 + 2 * DAY)).toMatchObject({ charge: 3, discharge: 1.5, ev: 3 });
  expect(hourSum(plant, T0, T0 + 4 * H)).toMatchObject({ charge: 0.5, discharge: 1.5, ev: 3 });
});

test("time without a house reading is not covered, and long holes are gaps", () => {
  const span = (h0: number, h1: number) => ({
    start: new Date(T0 + h0 * H).toISOString(),
    end: new Date(T0 + h1 * H).toISOString(),
    mean: 1000,
  });

  // Hours 1 and 2 unread.
  const [first, , , last] = hours(1000, 0, 0, 1000);
  const load = [first!, last!];

  const plant: Plant = {
    ...PLANT,
    load: [span(0, 1), span(3, 4)],
    hours: { ...PLANT.hours, load },
  };

  expect(hourSum(plant, T0, T0 + 4 * H).covered).toBe(2 * H);
  expect(gapsOf(plant, T0, T0 + 5 * H, T0 + 5 * H)).toEqual([
    { start: T0 + 1 * H, end: T0 + 3 * H },
    { start: T0 + 4 * H, end: T0 + 5 * H },
  ]);
  expect(gapsOf(plant, T0, T0 + 4 * H + H / 2, T0 + 4 * H + H / 2)).toEqual([
    { start: T0 + 1 * H, end: T0 + 3 * H },
  ]);
});
