/// <reference types="bun" />
import { expect, test } from "bun:test";
import { ambientOf, lightOf, luma, south } from "./light.harness.ts";
import { daylight } from "./light.ts";

// The light follows the weather (ADR 20 Look): the diffuse share of the global irradiance.

/** Diffuse fractions from a clear sky to a closed one, and none. */
const SKIES = [null, 0, 0.2, 0.45, 0.6, 0.8, 1] as const;

test("under every sky, light never falls as the sun rises", () => {
  for (const diffuse of SKIES) {
    let last = lightOf(daylight(south(-18), diffuse));

    for (let tenths = -179; tenths <= 900; tenths++) {
      const next = lightOf(daylight(south(tenths / 10), diffuse));

      expect(next).toBeGreaterThanOrEqual(last - 1e-9);
      last = next;
    }
  }
});

test("without weather for the instant, and under a sunny sky, the light is the clear sky's", () => {
  for (const elevation of [-8, 0, 4, 20, 60]) {
    expect(daylight(south(elevation), null)).toEqual(daylight(south(elevation)));
    expect(daylight(south(elevation), 0.15)).toEqual(daylight(south(elevation)));
  }
});

test("an overcast noon is still day: two thirds of a clear noon, lit by a brighter, grey sky", () => {
  // A clear sun on the horizon is three tenths of the zenith's light; an overcast noon stays
  // clear of dusk.
  const [clear, overcast] = [daylight(south(60)), daylight(south(60), 0.95)];
  const { sky } = overcast.fill;

  expect(lightOf(overcast) / lightOf(clear)).toBeGreaterThanOrEqual(2 / 3);
  expect(lightOf(overcast)).toBeLessThan(lightOf(clear));
  expect(lightOf(overcast)).toBeGreaterThanOrEqual(lightOf(daylight(south(5))) - 1e-9);
  expect(overcast.night).toBe(false);
  expect(ambientOf(overcast)).toBeGreaterThan(ambientOf(clear));
  // Grey: no channel a tenth off another.
  expect(Math.max(sky.r, sky.g, sky.b) / Math.min(sky.r, sky.g, sky.b)).toBeLessThan(1.1);
});

test("an overcast winter noon is no darker than a clear one's shade, its fill grey and strong", () => {
  const [clear, overcast] = [daylight(south(21)), daylight(south(21), 0.95)];

  expect(ambientOf(overcast)).toBeGreaterThan(1.3 * ambientOf(clear));
  expect(overcast.fill.intensity).toBeGreaterThan(1.5 * clear.fill.intensity);
});

test("overcast, a third of the sun's own light is left: a soft key light under the sky's", () => {
  const [clear, overcast] = [daylight(south(60)), daylight(south(60), 0.95)];

  expect(overcast.intensity / clear.intensity).toBeGreaterThan(0.25);
  expect(overcast.intensity / clear.intensity).toBeLessThan(0.5);
  expect(overcast.shadow).toBeGreaterThan(2 * clear.shadow);
  // The sky leads: the sun adds under half of what it gives a shadowed face.
  expect(overcast.intensity * luma(overcast.colour)).toBeLessThan(0.5 * ambientOf(overcast));
});

test("a partly cloudy sky lies between the clear and the overcast one", () => {
  const [clear, partly, overcast] = [0.1, 0.6, 0.95].map((diffuse) => daylight(south(40), diffuse));

  expect(partly!.intensity).toBeLessThan(clear!.intensity);
  expect(partly!.intensity).toBeGreaterThan(overcast!.intensity);
  expect(ambientOf(partly!)).toBeGreaterThan(ambientOf(clear!));
  expect(lightOf(partly!)).toBeLessThan(lightOf(clear!));
  expect(lightOf(partly!)).toBeGreaterThanOrEqual(lightOf(overcast!) - 1e-9);
  expect(partly!.clouds.coverage).toBeGreaterThan(clear!.clouds.coverage);
  expect(partly!.clouds.coverage).toBeLessThan(overcast!.clouds.coverage);
});

test("the sky model's clouds are as the prototype's when clear and thick when overcast", () => {
  expect(daylight(south(40)).clouds).toEqual({ coverage: 0.32, density: 0.35 });

  const { clouds } = daylight(south(40), 1);

  expect(clouds.coverage).toBeGreaterThan(0.8);
  expect(clouds.density).toBeGreaterThan(0.7);
});

test("the weather leaves the moonlit night as it is", () => {
  for (const elevation of [-12, -20]) {
    const [clear, overcast] = [daylight(south(elevation)), daylight(south(elevation), 1)];

    expect({ ...overcast, clouds: clear.clouds }).toEqual(clear);
  }
});

test("the weather steps nowhere: the light eases from sky to sky and across the horizon", () => {
  for (const diffuse of [0.6, 1]) {
    let last = daylight(south(8), diffuse);

    for (let i = 1; i <= 440; i++) {
      const next = daylight(south(8 - i * 0.05), diffuse);

      expect(Math.abs(next.intensity - last.intensity)).toBeLessThan(0.1);
      expect(Math.abs(ambientOf(next) - ambientOf(last))).toBeLessThan(0.05);
      expect(Math.abs(luma(next.fill.sky) - luma(last.fill.sky))).toBeLessThan(0.01);
      last = next;
    }
  }
});
