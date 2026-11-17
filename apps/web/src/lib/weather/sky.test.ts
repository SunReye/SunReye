/// <reference types="bun" />
import { expect, test } from "bun:test";
import { skyOf } from "./sky.ts";
import type { Weather } from "./weather.ts";

const weather = (known: Partial<Weather>): Weather => ({
  cloud: null,
  code: null,
  precipitation: null,
  snowfall: null,
  snowDepth: null,
  visibility: null,
  wind: null,
  windDirection: null,
  celsius: null,
  ghi: null,
  clearness: null,
  dry: null,
  ...known,
});

const sky = (known: Partial<Weather>) => skyOf(weather(known));

/** By day, under an open sky. */
const coded = (...codes: readonly number[]) =>
  codes.map((code) => sky({ code, cloud: 0.1, ghi: 300 }));

test("a wet, foggy or thundery weather code names the sky, whatever the cloud", () => {
  expect(coded(45, 48)).toEqual(["fog", "fog"]);
  expect(coded(51, 55, 57)).toEqual(["drizzle", "drizzle", "drizzle"]);
  expect(coded(61, 65, 67)).toEqual(["rain", "rain", "rain"]);
  expect(coded(71, 75, 77, 85, 86)).toEqual(["snow", "snow", "snow", "snow", "snow"]);
  expect(coded(80, 82)).toEqual(["showers", "showers"]);
  expect(coded(95, 96, 99)).toEqual(["thunder", "thunder", "thunder"]);
});

test("under a dry code the word follows the cloud, not the code's own cloud", () => {
  expect(sky({ code: 3, cloud: 0.1, ghi: 300 })).toBe("sunny");
  expect(sky({ code: 3, cloud: 0.5, ghi: 300 })).toBe("fair");
  expect(sky({ code: 0, cloud: 0.7, ghi: 300 })).toBe("cloudy");
  expect(sky({ code: 0, cloud: 0.9, ghi: 300 })).toBe("overcast");
});

test("without a cloud value the code's own cloud names the sky", () => {
  expect([0, 1, 2, 3].map((code) => sky({ code }))).toEqual([
    "sunny",
    "fair",
    "cloudy",
    "overcast",
  ]);
});

test("at night an open sky is clear, not sunny", () => {
  expect(sky({ code: 0, cloud: 0.2, ghi: 0 })).toBe("clear");
  expect(sky({ code: 1, ghi: 0 })).toBe("clear");
  expect(sky({ cloud: 0.9, ghi: 0 })).toBe("overcast");
  expect(sky({ code: 63, ghi: 0 })).toBe("rain");
});

test("without a code and a cloud value the sky has no word", () => {
  expect(sky({ ghi: 300, celsius: 12 })).toBeNull();
});
