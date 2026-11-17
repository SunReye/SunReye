/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Plot } from "./plot.ts";

test("the fog starts four radii past the plot", () => {
  const plot = new Plot();

  plot.fit(0, 0, 10);

  expect([plot.fog.near, plot.fog.far]).toEqual([80, 320]);
});

test("weather fog closes in round the plot, and stays as the plot is fitted again", () => {
  const plot = new Plot();

  plot.fit(0, 0, 10);
  plot.mist(1);
  expect([plot.fog.near, plot.fog.far]).toEqual([10, 90]);
  plot.fit(0, 0, 20);
  expect([plot.fog.near, plot.fog.far]).toEqual([20, 150]);
  plot.mist(0.5);
  expect([plot.fog.near, plot.fog.far]).toEqual([70, 315]);
  plot.mist(0);
  expect([plot.fog.near, plot.fog.far]).toEqual([120, 480]);
});

test("the floor is named, so the weather finds it", () => {
  expect(new Plot().floor.name).toBe("floor");
});
