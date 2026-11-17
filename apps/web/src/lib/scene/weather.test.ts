/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Weather } from "../weather/weather.ts";
import { south } from "./light.harness.ts";
import { DRY, fogColour, sceneWeather } from "./weather.ts";

const MINUTE = 60_000;

const weather = (known: Partial<Weather> = {}): Weather => ({
  cloud: null,
  code: null,
  precipitation: null,
  snowfall: null,
  snowDepth: null,
  visibility: null,
  wind: null,
  windDirection: null,
  celsius: null,
  ghi: null,
  clearness: null,
  dry: null,
  ...known,
});

const fog = (visibility: number) => sceneWeather(weather({ visibility })).fog;

const wet = (dry: number | null) => sceneWeather(weather({ dry })).wet;

const snow = (snowDepth: number) => sceneWeather(weather({ snowDepth })).snow;

const thunder = (code: number) => sceneWeather(weather({ code })).thunder;

/** A plant at noon whose strings read next to nothing. */
const DARK_NOON = { sun: south(20), share: 0.01 };

const covered = (known: Partial<Weather>, plant?: Parameters<typeof sceneWeather>[1]) =>
  sceneWeather(weather({ snowDepth: 0.05, ...known }), plant).covered;

test("an instant without weather is clear and dry, whatever the plant reads", () => {
  expect(sceneWeather(weather())).toEqual(DRY);
  expect(sceneWeather(weather(), DARK_NOON)).toEqual(DRY);
  expect(DRY).toEqual({ fog: 0, wet: 0, snow: false, covered: false, thunder: false });
});

test("fog thickens as the visibility falls: none from 10 km, whole under 200 m", () => {
  expect([fog(24_000), fog(10_000), fog(200), fog(50)]).toEqual([0, 0, 1, 1]);

  let last = 0;

  for (let metres = 10_000; metres >= 200; metres -= 100) {
    expect(fog(metres)).toBeGreaterThanOrEqual(last);
    last = fog(metres);
  }

  // Mist at 4 km shows; fog starts at 1 km, well over half of the way.
  expect(fog(4000)).toBeGreaterThan(0.1);
  expect(fog(4000)).toBeLessThan(0.4);
  expect(fog(1000)).toBeGreaterThan(0.5);
});

test("the codes 45 and 48 are fog without a visibility, as the archive has them: 1 km's", () => {
  const km = sceneWeather(weather({ visibility: 1000 })).fog;

  expect(sceneWeather(weather({ code: 45 })).fog).toBe(km);
  expect(sceneWeather(weather({ code: 48, visibility: 20_000 })).fog).toBe(km);
  // A lower visibility still thickens it.
  expect(sceneWeather(weather({ code: 45, visibility: 150 })).fog).toBe(1);
  expect(sceneWeather(weather({ code: 3 })).fog).toBe(0);
});

test("the ground is wet while it falls and dries over an hour", () => {
  expect([wet(null), wet(0), wet(60 * MINUTE), wet(300 * MINUTE)]).toEqual([0, 1, 0, 0]);
  expect(wet(30 * MINUTE)).toBeCloseTo(0.5);

  let last = 1;

  for (let minutes = 0; minutes <= 60; minutes++) {
    expect(wet(minutes * MINUTE)).toBeLessThanOrEqual(last);
    last = wet(minutes * MINUTE);
  }
});

test("snow lies from 1 cm of snow depth", () => {
  expect([snow(0), snow(0.009), snow(0.01), snow(0.4)]).toEqual([false, false, true, true]);
});

test("the codes 95 to 99 are thunder", () => {
  expect([94, 95, 96, 99, 100, 65].map((code) => thunder(code))).toEqual([
    false,
    true,
    true,
    true,
    false,
    false,
  ]);
});

test("modules are snow-covered while snow lies, the sun is up, the plant reads next to nothing and the core measured no sky", () => {
  expect(covered({}, DARK_NOON)).toBe(true);
  // The core measured a sky: the modules are clear, however little they make.
  expect(covered({ clearness: 0.3 }, DARK_NOON)).toBe(false);
  // No snow lies.
  expect(covered({ snowDepth: 0.004 }, DARK_NOON)).toBe(false);
  // No reading, as for a forecast instant or an inverter that is off.
  expect(covered({})).toBe(false);
  expect(covered({}, { sun: south(20), share: null })).toBe(false);
  // A low or unknown sun: the core measures no sky then either.
  expect(covered({}, { sun: south(8), share: 0.01 })).toBe(false);
  expect(covered({}, { sun: null, share: 0.01 })).toBe(false);
  // The plant produces: an index is missing for another reason, such as its AC limit.
  expect(covered({}, { sun: south(20), share: 0.05 })).toBe(false);
});

test("the fog is the page's colour in clear air and greys with the weather's fog", () => {
  const page = [0.9, 0.9, 0.93] as const;
  const night = [0.01, 0.012, 0.016] as const;

  expect(fogColour(page, false, 0)).toEqual([...page]);
  expect(fogColour(night, true, 0)).toEqual([...night]);

  const [half, whole] = [fogColour(page, false, 0.5), fogColour(page, false, 1)];

  // Darker than the light page, the more the thicker, and close to neutral.
  expect(whole[1]).toBeLessThan(half[1]);
  expect(half[1]).toBeLessThan(page[1]);
  expect(whole[1]).toBeGreaterThan(0.3);
  expect(Math.max(...whole) / Math.min(...whole)).toBeLessThan(1.15);
  // On the dark page it lifts: grey, not black.
  expect(fogColour(night, true, 1)[1]).toBeGreaterThan(3 * night[1]);
  expect(fogColour(night, true, 1)[1]).toBeLessThan(0.15);
});
