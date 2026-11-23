/// <reference types="bun" />
import { expect, test } from "bun:test";
import { skyStep } from "../../../../../packages/builder/src/scene/sky-step.ts";

// When the sky that lights the scene is made again (ADR 20 Rendering): only once the sun has
// moved far enough to show.

/** Toward a sun `elevation` degrees up, `azimuth` degrees from north. */
function sun(elevation: number, azimuth: number): [number, number, number] {
  const [up, round] = [(elevation * Math.PI) / 180, (azimuth * Math.PI) / 180];

  return [Math.cos(up) * Math.sin(round), Math.cos(up) * Math.cos(round), Math.sin(up)];
}

/** How many skies a sweep of 30 steps makes: a quarter of a degree each, as a minute moves the
 * sun, from `elevation` up and round. */
function skies(elevation: number): number {
  const steps = Array.from({ length: 30 }, (_, i) =>
    skyStep(sun(elevation + i * 0.1, 180 + i * 0.25)),
  );

  return new Set(steps).size;
}

test("a high sun moves 5° before the sky is made again: half an hour of minutes makes two or three", () => {
  expect(skies(40)).toBeLessThanOrEqual(3);
  expect(skies(60)).toBeLessThanOrEqual(3);
});

test("a lower sun's sky turns sooner: every 2.5° below 35°, and every degree below 15°", () => {
  expect(skies(20)).toBeGreaterThanOrEqual(3);
  expect(skies(20)).toBeLessThanOrEqual(6);
  expect(skies(5)).toBeGreaterThanOrEqual(7);
  // Through the horizon and the twilight under it.
  expect(skies(-5)).toBeGreaterThanOrEqual(7);
});

test("once the sun is 10° under the horizon the sky is one, wherever the sun is", () => {
  expect(skyStep(sun(-10.5, 0))).toBe(skyStep(sun(-40, 200)));
  expect(skyStep(sun(-10.5, 0))).not.toBe(skyStep(sun(-9, 0)));
});

test("the same sun is the same sky, and a far one another", () => {
  expect(skyStep(sun(50, 180))).toBe(skyStep(sun(50, 180)));
  expect(skyStep(sun(50, 180))).not.toBe(skyStep(sun(50, 200)));
  expect(skyStep(sun(50, 180))).not.toBe(skyStep(sun(20, 180)));
});
