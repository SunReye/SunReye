/// <reference types="bun" />
import { expect, test } from "bun:test";
import { hourly } from "./hourly.ts";
import type { Held, WeatherSources } from "./weather.ts";

const START = new Date("2026-11-14T00:00:00Z");
const at = (time: string, day = 14) => Date.parse(`2026-11-${day}T${time}:00Z`);
const MINUTE = 60_000;

/** A value held from `time` for `minutes`. */
const held = (time: string, value: number, minutes = 60, day = 14): Held => ({
  from: at(time, day),
  to: at(time, day) + minutes * MINUTE,
  value,
});

const days = (sources: Partial<WeatherSources>) =>
  hourly({ measured: {}, forecast: {}, ...sources }, "UTC", START);

const hour = (sources: Partial<WeatherSources>, time: string) =>
  days(sources)[0]?.hours.find((h) => h.at === at(time));

test("today and the next two days, each by its plant hours", () => {
  const read = days({});

  expect(read.map((d) => [d.start, d.end, d.hours.length])).toEqual([
    [at("00:00", 14), at("00:00", 15), 24],
    [at("00:00", 15), at("00:00", 16), 24],
    [at("00:00", 16), at("00:00", 17), 24],
  ]);
  expect(read[0]?.hours[13]?.at).toBe(at("13:00"));
});

test("a day the clocks go back has 25 hours", () => {
  const [day] = hourly(
    { measured: {}, forecast: {} },
    "Europe/Berlin",
    new Date("2026-10-24T22:00:00Z"),
  );

  expect(day?.hours.length).toBe(25);
});

test("an hour is the mean of its quarters; gusts are their strongest", () => {
  const read = hour(
    {
      forecast: {
        "weather.temperature": [held("12:00", 4, 15), held("12:15", 6, 15), held("12:30", 8, 30)],
        "weather.apparent_temperature": [held("12:00", 1)],
        "weather.gusts": [held("12:00", 9, 30), held("12:30", 14, 30)],
        "weather.wind": [held("12:00", 5)],
        "weather.wind_direction": [held("12:00", 270)],
        "weather.humidity": [held("12:00", 80, 30), held("12:30", 90, 30)],
        // mm/h and cm/h over half the hour each.
        "weather.precipitation": [held("12:00", 2, 30), held("12:30", 0, 30)],
        "weather.snowfall": [held("12:30", 1, 30)],
      },
    },
    "12:00",
  );

  expect(read).toMatchObject({
    celsius: 6.5,
    apparent: 1,
    gusts: 14,
    wind: 5,
    windDirection: 270,
    humidity: 85,
    precipitation: 1,
    snowfall: 0.5,
  });
});

test("an hour without stored weather has none", () => {
  expect(hour({}, "12:00")).toEqual({
    at: at("12:00"),
    sky: null,
    celsius: null,
    apparent: null,
    precipitation: null,
    snowfall: null,
    cloudCover: null,
    clearSkyIndex: null,
    wind: null,
    gusts: null,
    windDirection: null,
    humidity: null,
  });
});

test("what was measured stands for a past hour, the forecast for the rest", () => {
  const sources = {
    measured: { "weather.temperature": [held("08:00", 3)] },
    forecast: { "weather.temperature": [held("08:00", 9), held("09:00", 10)] },
  };

  expect(hour(sources, "08:00")?.celsius).toBe(3);
  expect(hour(sources, "09:00")?.celsius).toBe(10);
});

test("a measured value held over several hours covers each", () => {
  const sources = { measured: { "weather.cloud_cover": [held("06:00", 75, 180)] } };

  expect(hour(sources, "07:00")?.cloudCover).toBe(75);
  expect(hour(sources, "08:00")?.cloudCover).toBe(75);
  expect(hour(sources, "09:00")?.cloudCover).toBeNull();
});

test("cloud cover and the clear-sky index are apart, the index where it was measured", () => {
  const sources = {
    measured: { "weather.clearness": [held("10:00", 0.4, 30), held("10:30", 0.6, 30)] },
    forecast: { "weather.cloud_cover": [held("10:00", 90), held("11:00", 40)] },
  };

  expect(hour(sources, "10:00")).toMatchObject({ cloudCover: 90, clearSkyIndex: 0.5 });
  expect(hour(sources, "11:00")).toMatchObject({ cloudCover: 40, clearSkyIndex: null });
});

test("the hour's icon is its code's, the worst of its quarters; an open sky at night is clear", () => {
  const sources = {
    forecast: {
      "weather.code": [
        held("12:00", 3, 15),
        held("12:15", 63, 15),
        held("13:00", 2),
        held("22:00", 0),
      ],
      "weather.ghi": [held("12:00", 200), held("13:00", 200), held("22:00", 0)],
    },
  };

  expect(hour(sources, "12:00")?.sky).toBe("rain");
  expect(hour(sources, "13:00")?.sky).toBe("cloudy");
  expect(hour(sources, "22:00")?.sky).toBe("clear");
});

test("a day's sunshine is its hours' seconds in hours, measured ones not counted twice", () => {
  const [today, tomorrow] = days({
    measured: { "weather.sunshine": [held("10:00", 1800, 60)] },
    forecast: {
      "weather.sunshine": [held("10:00", 3600, 60), held("11:00", 900, 60)],
    },
  });

  // 1800 s measured in the tenth hour, 900 s forecast in the eleventh.
  expect(today?.sunshine).toBe(0.75);
  expect(tomorrow?.sunshine).toBeNull();
});

test("sunshine is seconds per hour in every tier: a day's mean counts for each of its hours", () => {
  const [today] = days({ measured: { "weather.sunshine": [held("00:00", 900, 24 * 60)] } });

  expect(today?.sunshine).toBe(6);
});

test("snow depth is the day's deepest, while snow lies: from 1 cm", () => {
  const [today, tomorrow] = days({
    forecast: {
      "weather.snow_depth": [
        held("06:00", 0.04),
        held("07:00", 0.12),
        held("06:00", 0.004, 60, 15),
      ],
    },
  });

  expect(today?.snowDepth).toBe(0.12);
  expect(tomorrow?.snowDepth).toBeNull();
});

test("visibility is the lowest of the day's fog; none without fog or without a value", () => {
  const [today, tomorrow, after] = days({
    measured: { "weather.code": [held("05:00", 45, 60, 16)] },
    forecast: {
      "weather.code": [held("06:00", 45), held("07:00", 48), held("08:00", 3)],
      "weather.visibility": [
        held("06:00", 400),
        held("07:00", 150),
        held("08:00", 90),
        held("06:00", 20_000, 60, 15),
      ],
    },
  });

  expect(today?.visibility).toBe(150);
  expect(tomorrow?.visibility).toBeNull();
  // Past fog comes from the code alone: the archive has no visibility (ADR 23).
  expect(after?.visibility).toBeNull();
});
