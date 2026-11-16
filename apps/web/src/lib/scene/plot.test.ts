/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Plot } from "./plot.ts";

test("the fog starts four radii past the plot", () => {
  const plot = new Plot();

  plot.fit(0, 0, 10);

  expect([plot.fog.near, plot.fog.far]).toEqual([80, 320]);
});
