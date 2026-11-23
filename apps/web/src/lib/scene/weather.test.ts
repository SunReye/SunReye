/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Weather } from "../weather/weather.ts";
import { south } from "./light.harness.ts";
import { sceneWeather } from "../weather/scene-weather.ts";
import { DRY, exact, fogColour, lightAlone } from "@sunreye/builder/scene/weather.ts";

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
  humidity: null,
  ghi: null,
  clearSkyIndex: null,
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
  expect(DRY).toEqual({
    fog: 0,
    wet: 0,
    snow: false,
    covered: false,
    thunder: false,
    falling: null,
    glass: null,
  });
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
  expect(covered({ clearSkyIndex: 0.3 }, DARK_NOON)).toBe(false);
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

const falling = (known: Partial<Weather>) => sceneWeather(weather(known)).falling;

test("rain falls while precipitation does, the denser the more: sparse in drizzle, whole from 8 mm/h", () => {
  expect(falling({ precipitation: 0 })).toBeNull();
  expect(falling({ precipitation: 0, snowfall: 0 })).toBeNull();
  expect(falling({ precipitation: 8 })).toEqual({ kind: "rain", density: 1, wind: [0, 0] });
  expect(falling({ precipitation: 40 })?.density).toBe(1);
  // Drizzle still shows.
  expect(falling({ precipitation: 0.1 })?.density).toBeGreaterThanOrEqual(0.1);
  expect(falling({ precipitation: 0.1 })?.density).toBeLessThan(0.3);
  expect(falling({ precipitation: 2 })?.density).toBe(0.5);

  let last = 0;

  for (let amount = 0.1; amount <= 10; amount += 0.1) {
    const { density } = falling({ precipitation: amount }) ?? { density: 0 };

    expect(density).toBeGreaterThanOrEqual(last);
    last = density;
  }
});

test("a thunderstorm pours: the whole field falls, whatever the amount, and is on the lens as densely", () => {
  const rain = sceneWeather(weather({ code: 63, precipitation: 4 }));
  const storm = sceneWeather(weather({ code: 95, precipitation: 4 }));

  expect(rain.falling?.density).toBeCloseTo(0.7);
  expect(storm.falling?.density).toBe(1);
  expect(storm.glass?.rain).toBe(1);
  // A storm that has not broken yet lets nothing fall.
  expect(sceneWeather(weather({ code: 95, precipitation: 0 })).falling).toBeNull();
});

test("snow falls while snowfall does, whole from 3 cm/h, and its water is not rain besides", () => {
  expect(falling({ snowfall: 3 })).toEqual({ kind: "snow", density: 1, wind: [0, 0] });
  expect(falling({ snowfall: 0.75, precipitation: 0.6 })).toEqual({
    kind: "snow",
    density: 0.5,
    wind: [0, 0],
  });
  expect(falling({ snowfall: 0, precipitation: 2 })?.kind).toBe("rain");
});

const carried = (wind: number, windDirection: number | null) =>
  falling({ precipitation: 2, wind, windDirection })?.wind;

test("what falls is carried away from where the wind blows from", () => {
  // East, north: a west wind carries east, a north wind south.
  expect(carried(5, 270)).toEqual([5, 0]);
  expect(carried(5, 0)).toEqual([0, -5]);
  expect(carried(4, 135)).toEqual([-3, 3]);
  // Without a direction it falls straight.
  expect(carried(5, null)).toEqual([0, 0]);
});

test("what falls moves in steps, so the scene is lit anew only when it shows", () => {
  const drizzle = { precipitation: 1, wind: 4, windDirection: 270 };

  expect(falling({ ...drizzle, precipitation: 1.04, wind: 4.1, windDirection: 271 })).toEqual(
    falling(drizzle),
  );
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

const glass = (known: Partial<Weather>) => sceneWeather(weather(known)).glass;

test("rain or snow in the air is on the lens as densely as it falls", () => {
  expect(glass({ precipitation: 8 })).toEqual({ rain: 1, snow: 0, frost: 0 });
  expect(glass({ precipitation: 2 })).toEqual({ rain: 0.5, snow: 0, frost: 0 });
  expect(glass({ precipitation: 1, snowfall: 3, celsius: 3 })).toEqual({
    rain: 0,
    snow: 1,
    frost: 0,
  });
});

test("frost is on the lens below about 0 °C in humid air, and more of it the colder", () => {
  expect(glass({ celsius: -4, humidity: 95 })).toEqual({ rain: 0, snow: 0, frost: 1 });

  const slight = glass({ celsius: -0.5, humidity: 95 })?.frost ?? 0;

  expect(slight).toBeGreaterThan(0);
  expect(slight).toBeLessThan(1);
});

test.each<readonly [string, Partial<Weather>]>([
  ["above freezing", { celsius: 4, humidity: 95 }],
  ["in dry air", { celsius: -8, humidity: 45 }],
  ["without a humidity", { celsius: -8 }],
  ["without a temperature", { humidity: 95 }],
  ["dry and mild", { celsius: 12, humidity: 60, precipitation: 0, snowfall: 0 }],
])("the lens is clear %s", (_, known) => {
  expect(glass(known)).toBeNull();
});

test("the lens changes only where it would show: a tenth of a percent is the same glass", () => {
  expect(glass({ celsius: -1.52, humidity: 84.1 })).toEqual(
    glass({ celsius: -1.5, humidity: 84.2 }),
  );
});

/** A thunderstorm in snow and fog over a snowed-in plant: all the scene's weather at once. */
const ALL = sceneWeather(
  weather({
    code: 96,
    visibility: 200,
    dry: 0,
    snowDepth: 0.05,
    snowfall: 3,
    wind: 4,
    windDirection: 270,
    celsius: -3,
    humidity: 90,
  }),
  DARK_NOON,
);

test("without its effects the weather keeps its light alone: thunder, and nothing else", () => {
  expect(ALL).toMatchObject({ fog: 1, wet: 1, snow: true, covered: true, thunder: true });
  expect(ALL.falling).not.toBeNull();
  expect(ALL.glass).not.toBeNull();

  expect(lightAlone(ALL)).toEqual({ ...DRY, thunder: true });
});

test("for editing the weather leaves out fog, wet ground, what falls and the glass, and keeps the snow", () => {
  expect(exact(ALL)).toEqual({
    fog: 0,
    wet: 0,
    snow: true,
    covered: true,
    thunder: true,
    falling: null,
    glass: null,
  });
});
