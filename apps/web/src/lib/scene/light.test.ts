/// <reference types="bun" />
import { expect, test } from "bun:test";
import { daylight, occlusion, theme } from "./light.ts";

/** Toward the sun at `elevation` degrees, due south. */
function south(elevation: number): [number, number, number] {
  const radians = (elevation * Math.PI) / 180;

  return [0, -Math.cos(radians), Math.sin(radians)];
}

test("the light shines from the given sun and lights the day", () => {
  const noon = daylight(south(60));

  expect(noon.night).toBe(false);
  expect(noon.toward[1]).toBeCloseTo(-0.5);
  expect(noon.toward[2]).toBeCloseTo(0.866);
  expect(noon.glow).toBe(1);
});

test("a low sun is weaker and warmer than a high one, and the cells glow less", () => {
  const [low, high] = [daylight(south(4)), daylight(south(50))];

  expect(low.intensity).toBeLessThan(high.intensity);
  expect(low.environment).toBeLessThan(high.environment);
  expect(low.glow).toBeLessThan(high.glow);
  // Warmer: less blue against red.
  expect(low.colour.b / low.colour.r).toBeLessThan(high.colour.b / high.colour.r);
});

test("below the horizon a cool moon shines from the north-west and the cells do not glow", () => {
  const night = daylight(south(-10));

  expect(night.night).toBe(true);
  expect(night.toward[0]).toBeLessThan(0);
  expect(night.toward[1]).toBeGreaterThan(0);
  expect(night.toward[2]).toBeGreaterThan(0);
  expect(night.glow).toBe(0);
  expect(night.colour.b).toBeGreaterThan(night.colour.r);
});

test("without the plant's location the sun stands still in the south-west afternoon", () => {
  const fixed = daylight(null);

  expect(fixed.night).toBe(false);
  expect(fixed.toward[0]).toBeLessThan(0);
  expect(fixed.toward[1]).toBeLessThan(0);
  expect(fixed).toEqual(daylight(null));
});

test("the dark theme is exposed lower and dims the sky light", () => {
  const [light, dark] = [theme(false), theme(true)];

  expect(dark.exposure).toBeLessThan(light.exposure);
  expect(dark.environment).toBeLessThan(light.environment);
});

test("ambient occlusion runs on the full motion tier only", () => {
  expect(occlusion("full")).toBe(true);
  expect(occlusion("lite")).toBe(false);
  expect(occlusion("still")).toBe(false);
});
