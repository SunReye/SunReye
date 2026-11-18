import { expect, test } from "bun:test";
import { sheetOf } from "./sheet-of.ts";

/** What sheet `id` charts over its range. */
const analyticsOf = (id: string, strings: Parameters<typeof sheetOf>[1]) =>
  sheetOf(id, strings)?.analytics ?? null;

/** What sheet `id`'s head sums over its range: its series, or none. */
const energyOf = (id: string) => {
  const head = sheetOf(id, STRINGS)?.head;

  return head?.kind === "energy" ? head.series : null;
};

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
  expect([battery.heat, energyOf("battery")]).toEqual([
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
  expect(energyOf("feedIn")).toBe("grid.export.power");
  expect(energyOf("production")).toBe("pv.power");
  expect(energyOf("string-4")).toBe("pv.string.power[4]");
  expect(energyOf("grid")).toBeNull();
});

test("the EV charts the plant's charging power, a loadpoint its own device's", () => {
  const ev = analyticsOf("ev", STRINGS)!;
  const loadpoint = analyticsOf("ev-8", STRINGS)!;

  expect([ev.device, ev.series, energyOf("ev")]).toEqual([
    PLANT,
    "ev.charge.power",
    "ev.charge.power",
  ]);
  expect([loadpoint.device, loadpoint.series, loadpoint.heat, energyOf("ev-8")]).toEqual([
    8,
    "ev.charge.power",
    "ev.charge.power",
    "ev.charge.power",
  ]);
  expect([loadpoint.compare, loadpoint.forecast, loadpoint.way]).toEqual([false, [], null]);
});

/** Where History opens from sheet `id`. */
const onward = (id: string) => sheetOf(id, STRINGS)?.history;

test("a detail sheet's figure opens its own view", () => {
  expect(onward("saved")).toEqual({ metric: "money", tab: null, sid: null });
  expect(onward("autarky")).toEqual({ metric: "autarky", tab: null, sid: null });
  expect(onward("forecast")).toEqual({ metric: null, tab: "forecast", sid: null });
  expect(onward("battery")).toEqual({ metric: "plant", tab: "battery", sid: null });
  expect(onward("string-4")).toEqual({ metric: "plant", tab: "strings", sid: "4" });
  expect(onward("production")).toEqual({ metric: null, tab: null, sid: null });
});
