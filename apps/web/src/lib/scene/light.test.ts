/// <reference types="bun" />
import { expect, test } from "bun:test";
import { ambientOf, lightOf, luma, skyOf, south } from "./light.harness.ts";
import { daylight, theme } from "./light.ts";
import { skylight } from "./skylight.ts";

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
  expect(low.environment * skylight(4, low.clouds.coverage)).toBeLessThan(
    high.environment * skylight(50, high.clouds.coverage),
  );
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
  const steps = Array.from({ length: 441 }, (_, i) => daylight(south(8 - i * 0.05)));

  for (const [i, next] of steps.entries()) {
    const last = steps[i - 1];

    if (last !== undefined) {
      expect(Math.abs(next.intensity - last.intensity)).toBeLessThan(0.1);
      // The fill and the sky model trade places near the horizon: their sum is what shows.
      expect(Math.abs(ambientOf(next) - ambientOf(last))).toBeLessThan(0.05);
      expect(Math.abs(luma(next.fill.sky) - luma(last.fill.sky))).toBeLessThan(0.01);
      expect(Math.abs(next.glow - last.glow)).toBeLessThan(0.01);

      // The one light turns from the sun to the moon only while it is out.
      if (next.night !== last.night)
        expect(Math.max(next.intensity, last.intensity)).toBeLessThan(0.05);
    }
  }
});

test("the sun's light is whole again at a low sun, the moon's at the end of nautical twilight", () => {
  expect(daylight(south(5)).intensity).toBe(2);
  expect(daylight(south(0)).intensity).toBe(0);
  // Civil twilight has no light that casts a shadow: the sky alone lights it.
  expect(daylight(south(-6)).intensity).toBe(0);
  expect(daylight(south(-12)).intensity).toBe(daylight(south(-40)).intensity);
});

test("light never falls as the sun rises, from astronomical twilight to the zenith", () => {
  let last = lightOf(daylight(south(-18)));

  for (let tenths = -179; tenths <= 900; tenths++) {
    const next = lightOf(daylight(south(tenths / 10)));

    expect(next).toBeGreaterThanOrEqual(last - 1e-9);
    last = next;
  }
});

test("a sun on the horizon is day: twice the moonlit night, two fifths of the zenith's light", () => {
  // The moonlit night is under a fifth of the zenith's light; sunrise sits well clear of it, as
  // bright as the rest of a winter morning.
  const [zenith, night] = [lightOf(daylight(south(90))), lightOf(daylight(south(-20)))];

  for (const elevation of [0, 1, 2, 3, 4, 5]) {
    const day = lightOf(daylight(south(elevation)));

    expect(day / night).toBeGreaterThanOrEqual(2);
    expect(day / zenith).toBeGreaterThanOrEqual(0.4);
  }
});

test("a low morning sun is exposed as a November noon is: from 3° up, nine tenths of the light at 21°", () => {
  // The owner's photo at 08:30 on 14 November, the sun 7° up: full daylight, a green lawn.
  const noon = lightOf(daylight(south(21)));

  for (const elevation of [3, 5, 7, 8]) {
    const morning = daylight(south(elevation));

    expect(lightOf(morning) / noon).toBeGreaterThanOrEqual(0.9);
    // The sky lights what the low sun cannot reach: the lawn and the faces turned from it.
    expect(ambientOf(morning)).toBeGreaterThan(2 * morning.intensity * luma(morning.colour));
    // Most of it from the sky model, whose reflections a fill has none of.
    expect(skyOf(morning)).toBeGreaterThanOrEqual(0.99 * skyOf(daylight(south(21))));
  }
});

test("the sky model's haze follows the sun's height with no switch", () => {
  expect(daylight(south(3)).haze).toBe(1);
  expect(daylight(south(60)).haze).toBe(0);

  for (let elevation = 5; elevation < 42; elevation += 0.5) {
    const [lower, higher] = [daylight(south(elevation)), daylight(south(elevation + 0.5))];

    expect(lower.haze - higher.haze).toBeGreaterThanOrEqual(0);
    expect(lower.haze - higher.haze).toBeLessThan(0.05);
  }
});

test("civil twilight is lit by the sky: more than the night, without the moon", () => {
  const [civil, night] = [daylight(south(-6)), daylight(south(-20))];

  expect(lightOf(civil)).toBeGreaterThan(lightOf(night));
  expect(civil.fill.intensity * luma(civil.fill.sky)).toBeGreaterThan(
    3 * night.fill.intensity * luma(night.fill.sky),
  );
});

test("the sky's light is warm at the horizon and blue below it", () => {
  for (const elevation of [0, 2, 5]) {
    const { sky } = daylight(south(elevation)).fill;

    expect(sky.r).toBeGreaterThan(sky.b);
  }

  for (const elevation of [-4, -6, -9, -12]) {
    const { sky } = daylight(south(elevation)).fill;

    expect(sky.b).toBeGreaterThan(sky.r);
  }
});

test("from the end of nautical twilight down, the night is #748's moonlight", () => {
  for (const elevation of [-12, -15, -30]) {
    const night = daylight(south(elevation));

    expect(night.intensity).toBeCloseTo(2.3, 10);
    expect(night.environment).toBeCloseTo(0.35, 10);
    expect(night.fill.intensity).toBeCloseTo(1.5, 10);
    // 0x93a5d8 over 0x4a5475, linear.
    expect(night.fill.sky.r).toBeCloseTo(0.2918, 3);
    expect(night.fill.sky.b).toBeCloseTo(0.6867, 3);
    expect(night.fill.ground.g).toBeCloseTo(0.0887, 3);
    expect(night.lamps).toBe(1);
  }
});

test("the house's lamps are out by day, on at night, and come on across dusk", () => {
  expect(daylight(south(30)).lamps).toBe(0);
  expect(daylight(south(4)).lamps).toBe(0);
  expect(daylight(south(-8)).lamps).toBe(1);

  const dusk = [2, 0, -2, -4].map((elevation) => daylight(south(elevation)).lamps);

  expect(dusk).toEqual(dusk.toSorted((a, b) => a - b));
  expect(dusk[1]).toBeGreaterThan(0);
  expect(dusk[1]).toBeLessThan(1);
});
