// The weather device's roles through Explore (ADR 23): picked by their labels, and the weather
// code drawn and read as a status is.
import { expect, test } from "bun:test";
import { WEATHER } from "../api/computed-devices.ts";
import type { CatalogDevice, History } from "../api/core.ts";
import { foldOf } from "./fold.ts";
import { lanesOf } from "./lanes.ts";
import { chosenOf, pickerOf } from "./picker.ts";
import { readSeries, type Reads } from "./read.ts";
import { figuresOf, lanesView, scenesOf } from "./series-chart.ts";

const SPAN = { first: "2026-01-01T00:00:00Z", last: "2026-11-15T12:00:00Z" };

const measured = (series: string, unit: string) =>
  ({ series, unit, kind: "measurement", estimated: false, ...SPAN }) as const;

/** As the core's catalog lists the weather device (ADR 23), out of order. */
const CATALOG: readonly CatalogDevice[] = [
  {
    id: WEATHER,
    name: null,
    removed: false,
    series: [
      measured("weather.clearness", "none"),
      measured("weather.snow_depth", "m"),
      measured("weather.cloud_cover", "%"),
      measured("weather.sunshine", "s"),
      measured("weather.apparent_temperature", "°C"),
      measured("weather.gusts", "m/s"),
      measured("weather.wind_direction", "°"),
      measured("weather.humidity", "%"),
      measured("weather.visibility", "m"),
      measured("weather.snowfall", "cm/h"),
      measured("weather.precipitation", "mm/h"),
      { series: "weather.code", unit: null, kind: "status", estimated: false, ...SPAN },
      measured("weather.wind", "m/s"),
      measured("weather.temperature", "°C"),
      measured("weather.ghi", "W/m²"),
    ],
  },
];

const picker = pickerOf(CATALOG);
const code = chosenOf({ device: WEATHER, series: "weather.code" }, picker);

test("the picker lists the weather's roles under the weather device, by their labels", () => {
  expect(picker.map((d) => [d.name, d.groups.map((g) => g.title)])).toEqual([
    ["Wetter", ["Wetter"]],
  ]);
  expect(picker[0]!.groups[0]!.series.map((s) => s.label)).toEqual([
    "Globalstrahlung",
    "Temperatur",
    "Wind",
    "Wettercode",
    "Niederschlag",
    "Schneefall",
    "Sichtweite",
    "Luftfeuchtigkeit",
    "Windrichtung",
    "Böen",
    "Gefühlte Temperatur",
    "Sonnenscheindauer",
    "Bewölkung",
    "Schneehöhe",
    "Clear-Sky-Index",
  ]);
});

const H = (hour: number) => `2026-11-10T${String(hour).padStart(2, "0")}:00:00Z`;

const CODES: History = {
  tier: "raw",
  points: [
    { start: H(0), end: H(6), mean: 3 },
    { start: H(6), end: H(9), mean: 61 },
    { start: H(9), end: H(24 - 1), mean: 2 },
  ],
};

const reads: Reads = {
  history: () => Promise.resolve(CODES),
  statistics: () => Promise.reject(new Error("a weather code has no statistics")),
};

test("a weather code draws as a band of states, read by the code's words", async () => {
  const plan = lanesOf([code]);
  const reading = await readSeries(reads, code, new Date(H(0)), new Date(H(23)));
  const lanes = lanesView({ plan, readings: [reading] }, 200);

  expect(reading.curve.draw).toBe("states");
  expect(lanes.map((l) => [l.lane.states, l.axis, l.caption])).toEqual([[true, null, "Status"]]);
  expect(scenesOf(lanes)[0]!.states).toBe(true);
  expect(figuresOf(lanes, Date.parse(H(7)))[0]).toMatchObject({
    label: "Wetter · Wettercode",
    value: "Leichter Regen",
    extremes: null,
  });
  expect(figuresOf(lanes, null)[0]!.value).toBe("Bewölkt");
});

test("a weather code has no fold, like any status", () => {
  expect(foldOf(code, "ready")).toBe("none");
  expect(foldOf(chosenOf({ device: WEATHER, series: "weather.clearness" }, picker), "ready")).toBe(
    "read",
  );
});
