import { afterEach, expect, test } from "vitest";
import { WEATHER_EFFECTS, WeatherEffects } from "./effects.svelte.ts";

afterEach(() => {
  localStorage.clear();
});

test("a browser starts with the weather effects on", () => {
  expect(new WeatherEffects().on).toBe(true);
});

test("the switch is kept per browser", () => {
  const effects = new WeatherEffects();

  effects.on = false;
  expect(localStorage.getItem(WEATHER_EFFECTS)).toBe("off");
  expect(new WeatherEffects().on).toBe(false);

  effects.on = true;
  expect(localStorage.getItem(WEATHER_EFFECTS)).toBe("on");
  expect(new WeatherEffects().on).toBe(true);
});
