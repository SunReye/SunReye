import { describe, expect, test } from "bun:test";
import { isReadableWeather } from "./weather";

const reading = {
  temperature: 21.4,
  unit: "°C",
  condition: "Clear",
  icon: "clear",
  solarRadiationSum: null,
  label: "Wiesbaden",
  forecast: null,
};

describe("isReadableWeather", () => {
  test("a complete reading is readable", () => {
    expect(isReadableWeather(reading)).toBe(true);
  });

  test("no payload is not readable", () => {
    expect(isReadableWeather(null)).toBe(false);
  });

  // Weather off ⇒ the server answers `null`, which reaches the client as "".
  // The tile must render nothing rather than "NaN undefined".
  test("an empty-body payload is not readable", () => {
    expect(isReadableWeather("" as unknown)).toBe(false);
  });

  test("a payload missing the temperature is not readable", () => {
    expect(isReadableWeather({ ...reading, temperature: undefined })).toBe(false);
  });

  test("a non-finite temperature is not readable", () => {
    expect(isReadableWeather({ ...reading, temperature: Number.NaN })).toBe(false);
    expect(isReadableWeather({ ...reading, temperature: Number.POSITIVE_INFINITY })).toBe(false);
  });

  test("a payload missing the unit is not readable", () => {
    expect(isReadableWeather({ ...reading, unit: undefined })).toBe(false);
  });

  test("0 °C is readable — a falsy temperature is still a temperature", () => {
    expect(isReadableWeather({ ...reading, temperature: 0 })).toBe(true);
  });

  test("a sub-zero temperature is readable", () => {
    expect(isReadableWeather({ ...reading, temperature: -7.5 })).toBe(true);
  });
});
