/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Plot } from "./plot.ts";

test("the fog starts four radii past the plot, under a lawn", () => {
  const plot = new Plot();

  plot.fit(0, 0, 10);

  expect([plot.fog.near, plot.fog.far, plot.lawn.visible]).toEqual([80, 320, true]);
});

test("imported surroundings take the lawn's place and push the fog out past them", () => {
  const plot = new Plot();

  plot.fit(0, 0, 10);
  plot.surround(200);

  expect([plot.fog.near, plot.fog.far, plot.lawn.visible]).toEqual([840, 3360, false]);

  // A new plot keeps them; without them the lawn and the plot's own fog are back.
  plot.fit(2, 3, 14);
  expect([plot.fog.near, plot.lawn.visible]).toEqual([840, false]);

  plot.surround(0);
  expect([plot.fog.near, plot.fog.far, plot.lawn.visible]).toEqual([96, 384, true]);
});
