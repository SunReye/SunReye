import { expect, test } from "bun:test";
import type { Band } from "../range/bands.ts";
import type { Sum } from "../history/flows.ts";
import { coverOf, extremes, wentOf } from "./autarky.ts";

const NONE: Sum = {
  production: 0,
  consumption: 0,
  feedIn: 0,
  purchase: 0,
  selfUsed: 0,
  selfCovered: 0,
  charge: 0,
  discharge: 0,
  ev: 0,
  autarky: null,
  selfUse: null,
  covered: 0,
};

/** 10 kWh of PV: 4 fed in, 2 charged into the battery; 8 kWh of house load: 2 bought, 1 discharged. */
const DAY: Sum = {
  ...NONE,
  production: 10,
  feedIn: 4,
  selfUsed: 6,
  charge: 2,
  consumption: 8,
  purchase: 2,
  selfCovered: 6,
  discharge: 1,
};

test("the house load is covered by PV directly, the battery and the grid", () => {
  expect(coverOf(DAY)).toEqual([62.5, 12.5, 25]);
});

test("PV goes to the house, the battery and the grid", () => {
  expect(wentOf(DAY)).toEqual([40, 20, 40]);
});

test("PV charges the battery only with what it did not feed in", () => {
  expect(wentOf({ ...DAY, charge: 9 })).toEqual([0, 60, 40]);
});

test("a plant without a battery splits in two", () => {
  const none = { ...DAY, charge: 0, discharge: 0 };

  expect(coverOf(none)).toEqual([75, 25]);
  expect(wentOf(none)).toEqual([60, 40]);
});

test("without load or PV there is nothing to split", () => {
  expect(coverOf(NONE)).toBeNull();
  expect(wentOf(NONE)).toBeNull();
});

const band = (key: string, autarky: number | null, state: Band["state"] = "data"): Band => ({
  key,
  label: key,
  tick: false,
  title: key,
  state,
  partial: false,
  up: autarky === null ? [] : [autarky],
  down: [],
  drillable: false,
});

test("the best and the worst band are the first of their kind", () => {
  const got = extremes([band("0", 0), band("1", 80), band("2", 100), band("3", 100), band("4", 0)]);

  expect(got.best?.key).toBe("2");
  expect(got.worst?.key).toBe("0");
});

test("a band without load, without readings or still running is neither best nor worst", () => {
  const got = extremes([
    band("0", null),
    band("1", null, "gap"),
    band("2", 40),
    band("3", 60),
    band("4", 100, "live"),
  ]);

  expect(got.best?.key).toBe("3");
  expect(got.worst?.key).toBe("2");
});

test("one band is not set against itself", () => {
  expect(extremes([band("0", 40)])).toEqual({ best: null, worst: null });
});
