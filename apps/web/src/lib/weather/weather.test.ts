/// <reference types="bun" />
import { expect, test } from "bun:test";
import { at, fake, intervals, read, targets, WEATHER } from "./weather.harness.ts";
import { readWeather, weatherAt, type Weather } from "./weather.ts";

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
  humidity: null,
  ghi: null,
  clearSkyIndex: null,
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
      "weather.humidity": targets(["12:00", 80], ["12:15", 93]),
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
    humidity: 93,
    ghi: 60,
    clearSkyIndex: null,
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
      "weather.humidity",
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
