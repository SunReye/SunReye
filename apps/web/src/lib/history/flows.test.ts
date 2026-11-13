import { expect, test } from "bun:test";
import { gapsOf, hourSum, NO_PLANT, sumOf, type Curves, type Plant } from "./flows.ts";

const H = 3_600_000;
const T0 = Date.parse("2026-11-03T00:00:00Z");
const at = (h: number) => new Date(T0 + h * H).toISOString();
const span = (h0: number, h1: number, mean: number) => ({ start: at(h0), end: at(h1), mean });

/** Four hours: sun at 2 kW and a 1 kW house, exporting; then dark, importing. */
const CURVES: Curves = {
  pv: [span(0, 2, 2000), span(2, 4, 0)],
  load: [span(0, 4, 1000)],
  imported: [span(0, 2, 0), span(2, 4, 1000)],
  exported: [span(0, 2, 1000), span(2, 4, 0)],
  selfUsed: [span(0, 2, 1000), span(2, 4, 0)],
  selfCovered: [span(0, 2, 1000), span(2, 4, 0)],
  battery: [],
  ev: [],
};

const DAY = 24 * H;
const rolled = (...whs: readonly number[]) => whs.map((wh, d) => ({ start: T0 + d * DAY, wh }));

/** Two days' rollups, which the curves above do not agree with. */
const PLANT: Plant = {
  ...CURVES,
  days: {
    ...NO_PLANT.days,
    pv: rolled(4000, 6000),
    load: rolled(4000, 5000),
    imported: rolled(2000, 1000),
    exported: rolled(2000, 2000),
    selfUsed: rolled(2000, 4000),
    selfCovered: rolled(2000, 4000),
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

test("a band of hours counts the part of each interval inside it", () => {
  expect(hourSum(PLANT, T0 + 1 * H, T0 + 3 * H)).toMatchObject({
    production: 2,
    consumption: 2,
    feedIn: 1,
    purchase: 1,
  });
});

test("the battery charges while its power is positive (ADR 4), and the car counts apart", () => {
  const plant = {
    ...PLANT,
    battery: [span(0, 1, 500), span(2, 3, -1500)],
    ev: [span(1, 2, 3000)],
    days: { ...PLANT.days, battery: rolled(500, -1500), ev: rolled(3000) },
  };

  expect(sumOf(plant, T0, T0 + 2 * DAY)).toMatchObject({ charge: 0.5, discharge: 1.5, ev: 3 });
  expect(hourSum(plant, T0, T0 + 4 * H)).toMatchObject({ charge: 0.5, discharge: 1.5, ev: 3 });
});

test("time without a house reading is not covered, and long holes are gaps", () => {
  const plant = { ...PLANT, load: [span(0, 1, 1000), span(3, 4, 1000)] };

  expect(sumOf(plant, T0, T0 + 4 * H).covered).toBe(2 * H);
  expect(gapsOf(plant, T0, T0 + 5 * H, T0 + 5 * H)).toEqual([
    { start: T0 + 1 * H, end: T0 + 3 * H },
    { start: T0 + 4 * H, end: T0 + 5 * H },
  ]);
  expect(gapsOf(plant, T0, T0 + 4 * H + H / 2, T0 + 4 * H + H / 2)).toEqual([
    { start: T0 + 1 * H, end: T0 + 3 * H },
  ]);
});
