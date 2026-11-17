import { expect, test } from "bun:test";
import { analyticsOf } from "./sources.ts";

const PLANT = 4_294_967_294;

const WIRING = { azimuth: 0, tilt: 30, loss: 0, optimized: 0, modules: 10, moduleType: 1 };

const STRINGS = [
  { id: 4, name: "Süd", device: 3, input: 1, ...WIRING },
  { id: 5, name: "Ost", device: 3, input: 2, ...WIRING },
];

test("an energy figure charts its plant series and heats the plant's rollups of its way", () => {
  const feedIn = analyticsOf("feedIn", STRINGS)!;

  expect([feedIn.device, feedIn.series]).toEqual([PLANT, "grid.power"]);
  expect(feedIn.heat).toBe("grid.export.power");
  expect(analyticsOf("purchase", STRINGS)!.heat).toBe("grid.import.power");
  expect(analyticsOf("string-4", STRINGS)!.heat).toBe("pv.string.power[4]");
});

test("a string reads its own series from its inverter, and compares with its siblings", () => {
  const string = analyticsOf("string-5", STRINGS)!;

  expect([string.device, string.series, string.compare]).toEqual([3, "pv.string.power[5]", true]);
  expect(analyticsOf("production", STRINGS)!.compare).toBe(true);
  expect(analyticsOf("production", STRINGS.slice(0, 1))!.compare).toBe(false);
  expect(analyticsOf("house", STRINGS)!.compare).toBe(false);
});

test("the battery heats and heads with what it discharged, as the plant splits it", () => {
  const battery = analyticsOf("battery", STRINGS)!;

  expect([battery.device, battery.series]).toEqual([PLANT, "battery.power"]);
  expect([battery.heat, battery.energy]).toEqual([
    "battery.discharge.power",
    "battery.discharge.power",
  ]);
  expect(battery.way).toBe("Entladen");
  expect(analyticsOf("feedIn", STRINGS)!.way).toBeNull();
});

test("figures without a series have no analytics", () => {
  expect(analyticsOf("price", STRINGS)).toBeNull();
  expect(analyticsOf("string-9", STRINGS)).toBeNull();
});

test("PV figures expect what their inverters forecast; others expect nothing", () => {
  const other = { ...STRINGS[0]!, id: 6, device: 7 };

  expect(analyticsOf("production", [...STRINGS, other])!.forecast).toEqual([3, 7]);
  expect(analyticsOf("pv", STRINGS)!.forecast).toEqual([3]);
  expect(analyticsOf("inverter", [...STRINGS, other])!.forecast).toEqual([3, 7]);
  expect(analyticsOf("house", STRINGS)!.forecast).toEqual([]);
  // A string's forecast is stored under its inverter, beside its history (ADR 17).
  expect(analyticsOf("string-6", [...STRINGS, other])!.forecast).toEqual([7]);
});

test("a one-way figure heads with its energy; a two-way one with none", () => {
  expect(analyticsOf("feedIn", STRINGS)!.energy).toBe("grid.export.power");
  expect(analyticsOf("production", STRINGS)!.energy).toBe("pv.power");
  expect(analyticsOf("string-4", STRINGS)!.energy).toBe("pv.string.power[4]");
  expect(analyticsOf("grid", STRINGS)!.energy).toBeNull();
});
