/// <reference types="bun" />
import { expect, test } from "bun:test";
import { sceneWeather } from "../weather/scene-weather.ts";
import { TRIAL_WEATHER } from "./trials.ts";

// Each trial weather draws what its name says (ADR 23 "Builder").

test.each([
  ["clear", { fog: 0, wet: 0, snow: false, thunder: false, falling: null, glass: null }],
  ["cloudy", { fog: 0, wet: 0, falling: null }],
  ["rain", { fog: 0, wet: 1, falling: { kind: "rain" }, glass: { snow: 0, frost: 0 } }],
  ["thunder", { wet: 1, thunder: true, falling: { kind: "rain", density: 1 } }],
  ["snow", { wet: 1, snow: true, falling: { kind: "snow" }, glass: { rain: 0 } }],
  ["fog", { fog: 1, wet: 0, falling: null }],
] as const)("%s", (trial, drawn) => {
  expect(sceneWeather(TRIAL_WEATHER[trial])).toMatchObject(drawn);
});

test("the light follows how closed the sky is: a cloudy trial is closed, a clear one open", () => {
  expect(TRIAL_WEATHER.clear.cloud).toBe(0);
  expect(TRIAL_WEATHER.cloudy.cloud).toBeGreaterThan(0.8);
});
