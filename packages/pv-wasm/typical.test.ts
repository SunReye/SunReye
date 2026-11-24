// A rounded location's typical year and the cautious yield need no browser (ADR 17): a consumer under Bun
// computes them through the engine and keys its cache by the rounded location.

import { expect, test } from "bun:test";
import type { WeatherSteps } from "./index.d.ts";
import { loadPv } from "./index.js";

const pv = await loadPv(await Bun.file(new URL("dist/pv.wasm", import.meta.url)).bytes());
const HOUR = 3600;
const QUARTER = 900;

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

test("twenty hourly past years give one typical year at quarter hours, each month from one of them", () => {
  const { weather, sources } = pv.typicalYear({ location: plant.location, years });

  expect(weather.start).toBe(Date.UTC(2001, 0, 1) / 1000 + QUARTER / 2);
  expect(weather.step).toBe(QUARTER);
  expect(weather.ghi).toHaveLength(35_040);
  expect(sources).toHaveLength(12);
  // The years brighten steadily, so every month's middle lies near 2009.
  expect(sources.every((year) => year >= 2007 && year <= 2012)).toBe(true);
});

test("nineteen past years are refused", () => {
  expect(() => pv.typicalYear({ location: plant.location, years: years.slice(1) })).toThrow(
    "19 past years, 20 needed",
  );
});

test("the quarter hours keep each source month's energy", () => {
  const { weather, sources } = pv.typicalYear({ location: plant.location, years });

  // Each month's hourly global irradiation in its source year, 29 February left out.
  const expected = sources.reduce((sum, year, month) => {
    const start = Date.UTC(year, 0, 1);
    const from = (Date.UTC(year, month, 1) - start) / 1000 / HOUR;
    const end = month === 1 ? Date.UTC(year, 1, 29) : Date.UTC(year, month + 1, 1);
    const to = (end - start) / 1000 / HOUR;
    const ghi = years[year - 2000]?.ghi ?? [];

    return sum + ghi.slice(from, to).reduce((a, b) => a + b, 0);
  }, 0);

  const quarters = weather.ghi.reduce((a, b) => a + b, 0) / 4;

  expect(Math.abs(quarters / expected - 1)).toBeLessThan(1e-9);
});

test("P50 is the simulated typical year and P90 lies below it by the past years' spread", () => {
  const { weather } = pv.typicalYear({ location: plant.location, years });
  const typical = pv.irradiation({ ...plant, weather });

  const past = years.map((year, i) => ({
    year: 2000 + i,
    irradiation: pv.irradiation({ ...plant, weather: year }),
  }));

  const figure = pv.cautious({ simulated: 10_000_000, typical, years: past });

  expect(past[19]?.irradiation ?? 0).toBeGreaterThan(past[0]?.irradiation ?? 0);
  expect(figure.p90).toBeLessThan(figure.p50);
  expect(figure.p50).toBe(10_000_000);
  expect(figure.p90).toBeCloseTo(
    10_000_000 * (1 - 1.281_551_565_544_6 * figure.basis.deviation),
    3,
  );
  expect(figure.basis.method).toBe("irradiationScaling");
  expect(figure.basis.typical).toBe(typical);
  expect(figure.basis.years).toEqual(past);
});
