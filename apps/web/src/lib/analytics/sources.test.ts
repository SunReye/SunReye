import { expect, test } from "bun:test";
import { analyticsOf } from "./sources.ts";

const PLANT = 4_294_967_294;

const WIRING = { azimuth: 0, tilt: 30, loss: 0, optimized: 0, modules: 10, moduleType: 1 };

const STRINGS = [
  { id: 4, name: "Süd", device: 3, input: 1, ...WIRING },
  { id: 5, name: "Ost", device: 3, input: 2, ...WIRING },
];

test("an energy figure charts its plant series and heats what flows its way", () => {
  const feedIn = analyticsOf("feedIn", STRINGS)!;

  expect([feedIn.device, feedIn.series]).toEqual([PLANT, "grid.power"]);
  expect(feedIn.heat?.(-2000)).toBe(2000);
  expect(feedIn.heat?.(500)).toBe(0);
  expect(analyticsOf("purchase", STRINGS)!.heat?.(500)).toBe(500);
});

test("a string reads its own series from its inverter, and compares with its siblings", () => {
  const string = analyticsOf("string-5", STRINGS)!;

  expect([string.device, string.series, string.compare]).toEqual([3, "pv.string.power[5]", true]);
  expect(analyticsOf("production", STRINGS)!.compare).toBe(true);
  expect(analyticsOf("production", STRINGS.slice(0, 1))!.compare).toBe(false);
  expect(analyticsOf("house", STRINGS)!.compare).toBe(false);
});

test("a signed battery has no heat; figures without a series have no analytics", () => {
  expect(analyticsOf("battery", STRINGS)!.heat).toBeNull();
  expect(analyticsOf("price", STRINGS)).toBeNull();
  expect(analyticsOf("string-9", STRINGS)).toBeNull();
});
