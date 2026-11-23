/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Weather } from "../weather/weather.ts";
import { Plot } from "./plot.ts";
import { sceneWeather } from "../weather/scene-weather.ts";

const NONE: Weather = {
  cloud: null,
  code: null,
  precipitation: null,
  snowfall: null,
  snowDepth: null,
  visibility: null,
  wind: null,
  windDirection: null,
  celsius: null,
  humidity: null,
  ghi: null,
  clearSkyIndex: null,
  dry: null,
};

test("the fog starts four radii past the plot", () => {
  const plot = new Plot();

  plot.fit(0, 0, 10);

  expect([plot.fog.near, plot.fog.far]).toEqual([80, 320]);
});

/** How much of a thing `metres` from the camera the fog takes, 0 to 1. */
function veiled({ near, far }: Readonly<{ near: number; far: number }>, metres: number): number {
  return Math.min(1, Math.max(0, (metres - near) / (far - near)));
}

test("weather fog is in metres: 300 m of visibility veils the plot's near side a little, deepens to its far side and takes the far ground", () => {
  const plot = new Plot();

  // The camera stands 2.5 radii from the plot's middle: its near side 15 m off, its far side 35.
  plot.fit(0, 0, 10);
  plot.mist(sceneWeather({ ...NONE, visibility: 300 }).fog);

  expect(veiled(plot.fog, 15)).toBeGreaterThan(0.08);
  expect(veiled(plot.fog, 15)).toBeLessThan(0.2);
  expect(veiled(plot.fog, 35)).toBeGreaterThan(veiled(plot.fog, 15) + 0.2);
  expect(veiled(plot.fog, 35)).toBeLessThan(0.5);
  expect(veiled(plot.fog, 100)).toBe(1);
});

test("the thickest fog starts near the camera and never hides the plot, however large", () => {
  const plot = new Plot();
  const reach = () => [plot.fog.near, plot.fog.far].map((metres) => Math.round(metres * 10) / 10);

  plot.fit(0, 0, 10);
  plot.mist(1);
  // 200 m of visibility over ln 50.
  expect(reach()).toEqual([2, 51.1]);
  // Its far side, 3.5 radii off, keeps a quarter of its contrast and more.
  expect(veiled(plot.fog, 35)).toBeLessThan(0.75);
  plot.fit(0, 0, 20);
  expect(reach()).toEqual([4.7, 95]);
  expect(veiled(plot.fog, 70)).toBeLessThan(0.75);
});

test("mist a kilometre deep and more leaves the plot's own distances as in clear air", () => {
  const plot = new Plot();

  plot.fit(0, 0, 20);
  plot.mist(sceneWeather({ ...NONE, visibility: 2000 }).fog);
  expect([plot.fog.near, plot.fog.far]).toEqual([120, 480]);
  plot.mist(0);
  expect([plot.fog.near, plot.fog.far]).toEqual([120, 480]);
});

test("the floor is named, so the weather finds it", () => {
  expect(new Plot().floor.name).toBe("floor");
});
