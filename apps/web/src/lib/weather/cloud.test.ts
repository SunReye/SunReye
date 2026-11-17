/// <reference types="bun" />
import { expect, test } from "bun:test";
import { weatherAt } from "./weather.ts";
import { at, intervals, read, targets } from "./weather.harness.ts";

// How closed the sky is at an instant (ADR 23 "The sky").

test("the cloud is the diffuse share of the global irradiance while the sun gives light and no cloud cover is stored", async () => {
  const weather = await read({
    forecasts: {
      "weather.ghi": targets(["11:00", 400], ["12:00", 300], ["13:00", 10]),
      "weather.dhi": targets(["11:00", 60], ["12:00", 285], ["13:00", 11]),
    },
  });

  expect(weatherAt(weather, at("11:30")).cloud).toBeCloseTo(0.15);
  expect(weatherAt(weather, at("12:20")).cloud).toBeCloseTo(0.95);
  // The forecast's rounding never makes more than all of it diffuse.
  expect(weatherAt(weather, at("13:10")).cloud).toBe(1);
});

test("in daylight the cloud is midway between the diffuse share and the cloud cover", async () => {
  const weather = await read({
    forecasts: {
      "weather.ghi": targets(["08:00", 100], ["11:00", 400], ["12:00", 300]),
      "weather.dhi": targets(["08:00", 50], ["11:00", 60], ["12:00", 300]),
      "weather.cloud_cover": targets(["08:00", 0], ["11:00", 100], ["12:00", 100]),
    },
  });

  // A low sun under a clear sky: half its light is diffuse, and no cloud is forecast.
  expect(weatherAt(weather, at("08:30")).cloud).toBeCloseTo(0.25);
  // Thin high cloud: the sky is covered, and the sun shines through.
  expect(weatherAt(weather, at("11:30")).cloud).toBeCloseTo(0.575);
  // A closed sky by both.
  expect(weatherAt(weather, at("12:20")).cloud).toBe(1);
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

test("the clear-sky index itself is told apart from the forecast's cloud: null where none stands", async () => {
  const weather = await read({
    history: { "weather.clearness": intervals(["11:45", "12:00", 0.4]) },
    forecasts: { "weather.cloud_cover": targets(["12:00", 100], ["13:00", 100]) },
  });

  expect(weatherAt(weather, at("12:07"))).toMatchObject({ clearSkyIndex: 0.4 });
  expect(weatherAt(weather, at("12:30"))).toMatchObject({ clearSkyIndex: null, cloud: 1 });
});

test("a quarter the core closed without an index is a null stored: no earlier quarter stands in for it", async () => {
  // Snow covered the modules from 11:45: the core stored null for that quarter.
  const weather = await read({
    history: { "weather.clearness": intervals(["11:30", "11:45", 0.4]) },
  });

  expect(weatherAt(weather, at("11:40")).clearSkyIndex).toBe(0.4);
  // Not closed yet by 11:45:30, the quarter to 11:45 still stands.
  expect(weatherAt(weather, at("11:50")).clearSkyIndex).toBe(0.4);
  expect(weatherAt(weather, Date.parse("2026-11-14T12:00:30Z")).clearSkyIndex).toBe(0.4);
  // The quarter to 12:00 has closed, and has none.
  expect(weatherAt(weather, at("12:02")).clearSkyIndex).toBeNull();
});

test("read later, a past quarter without an index has none, and a day ahead takes none of today's", async () => {
  const weather = await read({
    history: { "weather.clearness": intervals(["11:30", "11:45", 0.4]) },
  });

  expect(weatherAt(weather, at("11:50"), at("15:00")).clearSkyIndex).toBeNull();
  expect(weatherAt(weather, at("15:10"), at("11:50")).clearSkyIndex).toBeNull();
});
