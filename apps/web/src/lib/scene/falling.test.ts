/// <reference types="bun" />
import { expect, test } from "bun:test";
import { velocityOf } from "../../../../../packages/builder/src/scene/falling.ts";

const speed = (v: readonly number[]) => Math.hypot(...v);

/** Metres aside per metre down. */
const slant = (v: readonly [number, number, number]) => Math.hypot(v[0], v[2]) / -v[1];

test("rain streaks down fast and snow drifts down slowly, in three.js's frame", () => {
  const rain = velocityOf({ kind: "rain", density: 1, wind: [0, 0] });
  const snow = velocityOf({ kind: "snow", density: 1, wind: [0, 0] });

  // x east, y up, z south: straight down in still air.
  expect([rain[0], rain[2], snow[0], snow[2]]).toEqual([0, 0, 0, 0]);
  expect(rain[1]).toBeLessThan(-6);
  expect(snow[1]).toBeLessThan(-0.5);
  expect(snow[1]).toBeGreaterThan(-2.5);
});

test("the wind slants what falls the way it carries it, snow further than rain", () => {
  // Carried east and north at 5 m/s each.
  const rain = velocityOf({ kind: "rain", density: 1, wind: [5, 5] });
  const snow = velocityOf({ kind: "snow", density: 1, wind: [5, 5] });

  expect(rain[0]).toBeGreaterThan(0);
  expect(rain[2]).toBeLessThan(0);
  expect(rain[0]).toBe(-rain[2]);

  expect(slant(rain)).toBeGreaterThan(0.4);
  expect(slant(snow)).toBeGreaterThan(slant(rain));
});

test("a gale lays nothing flat: the slant stops short of level", () => {
  const snow = velocityOf({ kind: "snow", density: 1, wind: [40, 0] });

  expect(snow[0] / -snow[1]).toBeLessThan(6);
  expect(speed(snow)).toBeLessThan(12);
});
