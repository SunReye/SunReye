import { expect, test } from "bun:test";
import { codeKind, WEATHER_CODES, weatherWord } from "./weather-code.ts";

test("a weather code is written as its word: the sky's by ADR 23, the rest by intensity", () => {
  expect([0, 1, 2, 3].map((code) => weatherWord(code))).toEqual([
    "Sonnig",
    "Heiter",
    "Bewölkt",
    "Bedeckt",
  ]);
  expect(weatherWord(45)).toBe("Nebel");
  expect(weatherWord(61)).toBe("Leichter Regen");
  expect(weatherWord(75)).toBe("Starker Schneefall");
  expect(weatherWord(95)).toBe("Gewitter");
  expect(weatherWord(63, "en")).toBe("Rain");
});

test("every code of Open-Meteo's table has a word, and no other does", () => {
  expect([...WEATHER_CODES.keys()]).toEqual([
    0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86,
    95, 96, 97, 99,
  ]);
  expect(weatherWord(4)).toBeNull();
});

test.each(["de", "en"] as const)("no two codes share a word in %s", (locale) => {
  const words = [...WEATHER_CODES.keys()].map((code) => weatherWord(code, locale));

  expect(new Set(words).size).toBe(words.length);
});

const kinds = (...codes: readonly number[]) => codes.map((code) => codeKind(code));

test("a code tells what falls or hangs: fog at 45 and 48, thunder from 95 to 99, nothing past the table", () => {
  expect(kinds(45, 48)).toEqual(["fog", "fog"]);
  expect(kinds(51, 57, 61, 67)).toEqual(["drizzle", "drizzle", "rain", "rain"]);
  expect(kinds(71, 77, 85, 86)).toEqual(["snow", "snow", "snow", "snow"]);
  expect(kinds(80, 82)).toEqual(["showers", "showers"]);
  expect(kinds(95, 96, 99)).toEqual(["thunder", "thunder", "thunder"]);
  expect(kinds(0, 3, 44, 49, 87, 94, 100)).toEqual([null, null, null, null, null, null, null]);
  expect(codeKind(null)).toBeNull();
});
