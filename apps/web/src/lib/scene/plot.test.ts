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

  const reach = () => [plot.fog.near, plot.fog.far].map((metres) => Math.round(metres * 10) / 10);

  plot.fit(0, 0, 10);
  plot.mist(1);
  expect(reach()).toEqual([1, 35]);
  plot.fit(0, 0, 20);
  expect(reach()).toEqual([2, 60]);
  // Halfway to fog it is far nearer than halfway between the distances.
  plot.mist(0.5);
  expect(reach()).toEqual([3.9, 106.7]);
  plot.mist(0);
  expect(reach()).toEqual([120, 480]);
});

test("the floor is named, so the weather finds it", () => {
  expect(new Plot().floor.name).toBe("floor");
});
