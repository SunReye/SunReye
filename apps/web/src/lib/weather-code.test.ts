import { expect, test } from "bun:test";
import { WEATHER_CODES, weatherWord } from "./weather-code.ts";

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
