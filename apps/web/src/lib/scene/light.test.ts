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
  const steps = Array.from({ length: 441 }, (_, i) => daylight(south(8 - i * 0.05)));

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

test("a sun on the horizon is day: three fifths of noon's light, a third over the moonlit night", () => {
  // The moonlit night is 45 % of noon; a camera's day at sunrise sits well clear of it.
  const [noon, night] = [lightOf(daylight(south(90))), lightOf(daylight(south(-20)))];

  for (const elevation of [0, 1, 2, 3, 4, 5]) {
    const day = lightOf(daylight(south(elevation)));

    expect(day / noon).toBeGreaterThanOrEqual(0.6);
    expect(day / night).toBeGreaterThanOrEqual(4 / 3);
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
