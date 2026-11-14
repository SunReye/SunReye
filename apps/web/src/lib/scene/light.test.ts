/// <reference types="bun" />
import { expect, test } from "bun:test";
import { daylight, occlusion, theme, type Daylight, type Rgb } from "./light.ts";

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

const luma = ({ r, g, b }: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Direct plus ambient light; below the horizon the sky model is black, so only the fill counts. */
function lightOf(day: Daylight): number {
  const ambient = day.fill.intensity * luma(day.fill.sky) + (day.night ? 0 : day.environment);

  return day.intensity * luma(day.colour) + ambient;
}

test("a moonlit night keeps at least a third of a low sun's light, cool and soft", () => {
  const [night, low, high] = [daylight(south(-20)), daylight(south(5)), daylight(south(50))];

  expect(lightOf(night) / lightOf(low)).toBeGreaterThan(1 / 3);
  // Still a night: under half of the day's light.
  expect(lightOf(night) / lightOf(high)).toBeLessThan(0.5);
  // The fill is blue, and no stronger than the moon: its shadows stay.
  expect(night.fill.sky.b).toBeGreaterThan(night.fill.sky.r);
  expect(night.fill.intensity * luma(night.fill.sky)).toBeLessThan(
    night.intensity * luma(night.colour),
  );
});

test("dusk eases into night: no light steps across the horizon", () => {
  const steps = Array.from({ length: 321 }, (_, i) => daylight(south(8 - i * 0.05)));

  for (const [i, next] of steps.entries()) {
    const last = steps[i - 1];

    if (last !== undefined) {
      expect(Math.abs(next.intensity - last.intensity)).toBeLessThan(0.1);
      expect(Math.abs(next.environment - last.environment)).toBeLessThan(0.01);
      expect(Math.abs(next.fill.intensity - last.fill.intensity)).toBeLessThan(0.05);
      expect(Math.abs(luma(next.fill.sky) - luma(last.fill.sky))).toBeLessThan(0.01);
      expect(Math.abs(next.glow - last.glow)).toBeLessThan(0.01);

      // The one light turns from the sun to the moon only while it is out.
      if (next.night !== last.night)
        expect(Math.max(next.intensity, last.intensity)).toBeLessThan(0.05);
    }
  }
});

test("at the horizon, between sun and moon, the sky's fill is already the night's", () => {
  const [horizon, night] = [daylight(south(0)), daylight(south(-20))];

  expect(horizon.intensity).toBe(0);
  expect(horizon.fill.intensity).toBe(night.fill.intensity);
});

test("the sun's light is whole again at a low sun, the moon's a few degrees under the horizon", () => {
  expect(daylight(south(5)).intensity).toBe(2);
  expect(daylight(south(-6)).intensity).toBe(daylight(south(-40)).intensity);
});
