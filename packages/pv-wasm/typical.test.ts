// A rounded location's typical year and the cautious yield need no browser (ADR 17): a consumer under Bun
// computes them through the engine and keys its cache by the rounded location.

import { expect, test } from "bun:test";
import type { WeatherSteps } from "./index.d.ts";
import { loadPv } from "./index.js";

const pv = await loadPv(await Bun.file(new URL("dist/pv.wasm", import.meta.url)).bytes());
const HOUR = 3600;

/** The sun's share at the middle of hour `h` of a year. */
const sun = (h: number) => Math.max(0, Math.cos((((h % 24) + 0.5 - 12) / 24) * 2 * Math.PI));

/** A clear day every day, the brighter the later the year, stamped at each hour's middle as the
 * archive's hourly means are. */
function pastYear(year: number): WeatherSteps {
  const start = Date.UTC(year, 0, 1) / 1000;
  const hours = (Date.UTC(year + 1, 0, 1) / 1000 - start) / HOUR;
  const scale = 0.9 + 0.01 * (year - 2000);
  const column = (peak: number) => Array.from({ length: hours }, (_, h) => scale * peak * sun(h));

  return {
    start: start + HOUR / 2,
    step: HOUR,
    ghi: column(700),
    dni: column(500),
    dhi: column(200),
    temperature: Array.from({ length: hours }, () => 10 * scale),
  };
}

const years = Array.from({ length: 20 }, (_, i) => pastYear(2000 + i));

const plant = {
  location: pv.roundedLocation({ latitude: 52.5166, longitude: 13.3749 }),
  scene: { north: 180, blocks: [], obstacles: [] },
  moduleTypes: [
    {
      id: 1,
      vmp: 34.5,
      imp: 12.17,
      voc: 41.5,
      isc: 12.95,
      voltageCoefficient: -0.26,
      currentCoefficient: 0.048,
      width: 1.134,
      height: 1.722,
      bypassDiodes: 3,
    },
  ],
  strings: [
    {
      device: 7,
      input: 1,
      loss: 2,
      modules: 16,
      name: "",
      optimized: 0,
      tilt: 35,
      moduleType: 1,
      azimuth: 0,
    },
  ],
};

test("a rounded location is to a hundredth of a degree", () => {
  expect(plant.location).toEqual({ latitude: 52.52, longitude: 13.37 });
});

test("twenty past years give one typical year at their step, each month from one of them", () => {
  const { weather, sources } = pv.typicalYear({ years });

  expect(weather.start).toBe(Date.UTC(2001, 0, 1) / 1000 + HOUR / 2);
  expect(weather.step).toBe(HOUR);
  expect(weather.ghi).toHaveLength(8760);
  expect(sources).toHaveLength(12);
  // The years brighten steadily, so every month's middle lies near 2009.
  expect(sources.every((year) => year >= 2007 && year <= 2012)).toBe(true);
});

test("nineteen past years are refused", () => {
  expect(() => pv.typicalYear({ years: years.slice(1) })).toThrow("19 past years, 20 needed");
});

test("P50 and P90 scale the simulated year by each past year's irradiation", () => {
  const { weather } = pv.typicalYear({ years });
  const typical = pv.irradiation({ ...plant, weather });

  const past = years.map((year, i) => ({
    year: 2000 + i,
    irradiation: pv.irradiation({ ...plant, weather: year }),
  }));

  const figure = pv.cautious({ simulated: 10_000_000, typical, years: past });

  expect(past[19]?.irradiation ?? 0).toBeGreaterThan(past[0]?.irradiation ?? 0);
  expect(figure.p90).toBeLessThan(figure.p50);
  expect(Math.abs(figure.p50 / 10_000_000 - 1)).toBeLessThan(0.06);
  expect(figure.basis.method).toBe("irradiationScaling");
  expect(figure.basis.typical).toBe(typical);
  expect(figure.basis.years).toEqual(past);
});
