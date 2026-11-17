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
  ...known,
});

test("a wet, foggy or thundery weather code names the sky, whatever the cloud", () => {
  const named = (code: number) =>
    skyOf(weather({ code, cloud: 0.1, ghi: 300 }));

  expect([45, 48].map(named)).toEqual(["fog", "fog"]);
  expect([51, 55, 57].map(named)).toEqual(["drizzle", "drizzle", "drizzle"]);
  expect([61, 65, 67].map(named)).toEqual(["rain", "rain", "rain"]);
  expect([71, 75, 77, 85, 86].map(named)).toEqual([
    "snow",
    "snow",
    "snow",
    "snow",
    "snow",
  ]);
  expect([80, 82].map(named)).toEqual(["showers", "showers"]);
  expect([95, 96, 99].map(named)).toEqual(["thunder", "thunder", "thunder"]);
});

test("under a dry code the word follows the cloud, not the code's own cloud", () => {
  const named = (cloud: number) => skyOf(weather({ code: 3, cloud, ghi: 300 }));

  expect(named(0.1)).toBe("sunny");
  expect(named(0.5)).toBe("fair");
  expect(named(0.7)).toBe("cloudy");
  expect(named(0.9)).toBe("overcast");
});

test("without a cloud value the code's own cloud names the sky", () => {
  const named = (code: number) => skyOf(weather({ code }));

  expect([0, 1, 2, 3].map(named)).toEqual([
    "sunny",
    "fair",
    "cloudy",
    "overcast",
  ]);
});

test("at night an open sky is clear, not sunny", () => {
  expect(skyOf(weather({ code: 0, cloud: 0.2, ghi: 0 }))).toBe("clear");
  expect(skyOf(weather({ code: 1, ghi: 0 }))).toBe("clear");
  expect(skyOf(weather({ cloud: 0.9, ghi: 0 }))).toBe("overcast");
  expect(skyOf(weather({ code: 63, ghi: 0 }))).toBe("rain");
});

test("without a code and a cloud value the sky has no word", () => {
  expect(skyOf(weather({ ghi: 300, celsius: 12 }))).toBeNull();
});
