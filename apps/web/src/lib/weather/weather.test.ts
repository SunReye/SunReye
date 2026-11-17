/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Forecasts, History } from "../api/core.ts";
import { readWeather, weatherAt, type Weather } from "./weather.ts";

const WEATHER = 4_294_967_295;
const iso = (time: string) => `2026-11-14T${time}:00Z`;
const at = (time: string) => Date.parse(iso(time));

/** Forecast targets, as the core serves them. */
const targets = (...values: readonly (readonly [string, number])[]) =>
  values.map(([time, value]) => ({
    issued: iso("00:00"),
    target: iso(time),
    value,
  }));

/** History intervals, as the core serves them. */
const intervals = (...values: readonly (readonly [string, string, number])[]) =>
  values.map(([start, end, mean]) => ({
    start: iso(start),
    end: iso(end),
    mean,
  }));

interface Stored {
  readonly history?: Readonly<Record<string, readonly Readonly<History["points"][number]>[]>>;
  readonly forecasts?: Readonly<Record<string, readonly Readonly<Forecasts["points"][number]>[]>>;
}

/** A core that holds `stored` for the weather device, and what was asked of it. */
function fake(stored: Stored) {
  const asked: string[] = [];

  const core: Parameters<typeof readWeather>[0] = {
    history: (device, series) => {
      asked.push(`history ${device} ${series}`);

      return Promise.resolve({
        tier: "raw",
        points: [...(stored.history?.[series] ?? [])],
      });
    },
    forecasts: (device, series) => {
      asked.push(`forecasts ${device} ${series}`);

      return Promise.resolve({ points: [...(stored.forecasts?.[series] ?? [])] });
    },
  };

  return { core, asked };
}

const read = (stored: Stored) =>
  readWeather(fake(stored).core, new Date(at("00:00")), new Date(at("23:59")));

const NONE: Weather = {
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
};

test("without stored weather an instant has none", async () => {
  expect(weatherAt(await read({}), at("12:00"))).toEqual(NONE);
  expect(weatherAt(undefined, at("12:00"))).toEqual(NONE);
});

test("the weather at an instant is each forecast quantity in force then", async () => {
  const weather = await read({
    forecasts: {
      "weather.code": targets(["12:00", 61], ["12:15", 63]),
      "weather.precipitation": targets(["12:00", 0.4], ["12:15", 2.5]),
      "weather.snowfall": targets(["12:00", 0], ["12:15", 0.07]),
      "weather.snow_depth": targets(["12:00", 0.02]),
      "weather.visibility": targets(["12:00", 24_000], ["12:15", 900]),
      "weather.wind": targets(["12:00", 3.2], ["12:15", 5.5]),
      "weather.wind_direction": targets(["12:00", 270], ["12:15", 250]),
      "weather.temperature": targets(["12:00", 4.5], ["12:15", 4.1]),
      "weather.ghi": targets(["12:00", 80], ["12:15", 60]),
    },
  });

  expect(weatherAt(weather, at("12:20"))).toEqual({
    cloud: null,
    code: 63,
    precipitation: 2.5,
    snowfall: 0.07,
    snowDepth: 0.02,
    visibility: 900,
    wind: 5.5,
    windDirection: 250,
    celsius: 4.1,
    ghi: 60,
    clearness: null,
    dry: 0,
  });
});

test("a forecast value is held for its step: to the next target, an hour at most", async () => {
  const weather = await read({
    forecasts: {
      "weather.code": targets(["10:00", 2], ["10:15", 3], ["14:00", 71]),
      "weather.snow_depth": targets(["10:00", 0.03], ["11:00", 0.04]),
    },
  });

  expect(weatherAt(weather, at("09:59")).code).toBeNull();
  expect(weatherAt(weather, at("10:14")).code).toBe(2);
  expect(weatherAt(weather, at("10:15")).code).toBe(3);
  expect(weatherAt(weather, at("11:14")).code).toBe(3);
  expect(weatherAt(weather, at("11:15")).code).toBeNull();
  expect(weatherAt(weather, at("10:59")).snowDepth).toBe(0.03);
  expect(weatherAt(weather, at("11:59")).snowDepth).toBe(0.04);
  expect(weatherAt(weather, at("12:00")).snowDepth).toBeNull();
});

test("past weather comes from history where it covers the instant, else from the forecast", async () => {
  const weather = await read({
    history: {
      "weather.code": intervals(["08:00", "09:00", 71], ["09:00", "10:00", 73]),
      "weather.temperature": intervals(["08:00", "10:00", -1.5]),
    },
    forecasts: {
      "weather.code": targets(["09:45", 3], ["10:00", 3]),
      "weather.temperature": targets(["09:45", 0.5], ["10:00", 1]),
      "weather.visibility": targets(["09:45", 4000]),
    },
  });

  expect(weatherAt(weather, at("09:50"))).toMatchObject({
    code: 73,
    celsius: -1.5,
    visibility: 4000,
  });
  expect(weatherAt(weather, at("10:05"))).toMatchObject({
    code: 3,
    celsius: 1,
  });
});

test("the cloud is the diffuse share of the global irradiance while the sun gives light", async () => {
  const weather = await read({
    forecasts: {
      "weather.ghi": targets(["11:00", 400], ["12:00", 300], ["13:00", 10]),
      "weather.dhi": targets(["11:00", 60], ["12:00", 285], ["13:00", 11]),
      "weather.cloud_cover": targets(["11:00", 100], ["12:00", 0], ["13:00", 0]),
    },
  });

  expect(weatherAt(weather, at("11:30")).cloud).toBeCloseTo(0.15);
  expect(weatherAt(weather, at("12:20")).cloud).toBeCloseTo(0.95);
  // The forecast's rounding never makes more than all of it diffuse.
  expect(weatherAt(weather, at("13:10")).cloud).toBe(1);
});

test("at night, when the light tells nothing, the cloud is the cloud cover", async () => {
  const weather = await read({
    forecasts: {
      "weather.ghi": targets(["02:00", 0]),
      "weather.dhi": targets(["02:00", 0]),
      "weather.cloud_cover": targets(["02:00", 70], ["04:00", 20]),
    },
  });

  expect(weatherAt(weather, at("02:30")).cloud).toBeCloseTo(0.7);
  // No irradiance stored at all: the cloud cover still tells.
  expect(weatherAt(weather, at("04:30")).cloud).toBeCloseTo(0.2);
});

test("where the clear-sky index has a value the cloud is the measured sky, whatever the forecast says", async () => {
  const forecasts = {
    "weather.ghi": targets(["11:00", 400], ["12:00", 400]),
    "weather.dhi": targets(["11:00", 60], ["12:00", 60]),
  };

  const weather = await read({
    history: {
      "weather.clearness": intervals(
        ["11:00", "11:15", 1],
        ["11:15", "11:30", 0.25],
        ["11:30", "11:45", 0.625],
        ["11:45", "12:00", 1.2],
      ),
    },
    forecasts,
  });

  expect(weatherAt(weather, at("11:05")).cloud).toBe(0);
  expect(weatherAt(weather, at("11:20")).cloud).toBe(1);
  expect(weatherAt(weather, at("11:40")).cloud).toBeCloseTo(0.5);
  // Cloud edges can lift the plant over its clear-sky estimate.
  expect(weatherAt(weather, at("11:50")).cloud).toBe(0);
  // Past the index, the forecast again.
  expect(weatherAt(weather, at("12:30")).cloud).toBeCloseTo(0.15);
});

test("the last closed quarter's clear-sky index stands for now until the next one closes", async () => {
  // The core closes a quarter half a minute after its end, so now is never inside an interval.
  const weather = await read({
    history: { "weather.clearness": intervals(["11:45", "12:00", 0.25]) },
    forecasts: {
      "weather.ghi": targets(["12:00", 400], ["12:15", 400]),
      "weather.dhi": targets(["12:00", 60], ["12:15", 60]),
    },
  });

  expect(weatherAt(weather, at("12:07")).cloud).toBe(1);
  expect(weatherAt(weather, at("12:15")).cloud).toBe(1);
  expect(weatherAt(weather, at("12:21")).cloud).toBeCloseTo(0.15);
});

test("the weather is read from the weather device: history and forecasts, the measured index from history alone, visibility from forecasts alone", async () => {
  const { core, asked } = fake({});

  await readWeather(core, new Date(at("00:00")), new Date(at("23:59")));

  expect(asked.toSorted()).toEqual(
    [
      "weather.code",
      "weather.precipitation",
      "weather.snowfall",
      "weather.snow_depth",
      "weather.wind",
      "weather.wind_direction",
      "weather.temperature",
      "weather.ghi",
      "weather.dhi",
      "weather.cloud_cover",
    ]
      .flatMap((series) => [`history ${WEATHER} ${series}`, `forecasts ${WEATHER} ${series}`])
      .concat([`history ${WEATHER} weather.clearness`, `forecasts ${WEATHER} weather.visibility`])
      .toSorted(),
  );
});

test("a refused or failed read is no weather for its quantity", async () => {
  const weather = await readWeather(
    {
      history: () => Promise.resolve({ problem: "history.range" }),
      forecasts: (_, series) =>
        series === "weather.code"
          ? Promise.resolve({ points: targets(["12:00", 45]) })
          : Promise.reject(new Error("offline")),
    },
    new Date(at("00:00")),
    new Date(at("23:59")),
  );

  expect(weatherAt(weather, at("12:05"))).toEqual({ ...NONE, code: 45 });
});

test("the clear-sky index itself is told apart from the forecast's cloud: null where none stands", async () => {
  const weather = await read({
    history: { "weather.clearness": intervals(["11:45", "12:00", 0.4]) },
    forecasts: { "weather.cloud_cover": targets(["12:00", 100], ["13:00", 100]) },
  });

  expect(weatherAt(weather, at("12:07"))).toMatchObject({ clearness: 0.4 });
  expect(weatherAt(weather, at("12:30"))).toMatchObject({ clearness: null, cloud: 1 });
});

test("an instant knows how long it has been dry: 0 while it falls, then since it last fell", async () => {
  const weather = await read({
    history: {
      "weather.precipitation": intervals(
        ["09:00", "09:15", 0],
        ["09:15", "09:30", 0.3],
        ["09:30", "09:45", 0],
      ),
    },
    forecasts: {
      // Archived as dry: history wins over the rain once forecast for that quarter.
      "weather.precipitation": targets(["09:30", 1.2], ["09:45", 0], ["14:00", 0.5], ["14:15", 0]),
    },
  });

  const dry = (time: string) => weatherAt(weather, at(time)).dry;

  // Nothing has fallen yet in what was read.
  expect(dry("09:10")).toBeNull();
  expect(dry("09:20")).toBe(0);
  expect(dry("09:50")).toBe(20 * 60_000);
  expect(dry("13:59")).toBe((4 * 60 + 29) * 60_000);
  expect(dry("14:05")).toBe(0);
  expect(dry("14:45")).toBe(30 * 60_000);
});
