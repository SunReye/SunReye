/// <reference types="bun" />
import { expect, test } from "bun:test";
import { settleRead } from "../api/client.ts";
import { perSeries } from "../api/core.harness.ts";
import { readWeatherSources, type WeatherReader } from "./weather.ts";

const WEATHER = 4_294_967_295;
const at = (time: string) => new Date(`2026-11-14T${time}:00Z`);
const minute = (date: Readonly<Date>) => date.toISOString().slice(0, 16);

/** The forecasts stored ahead, by series. */
const AHEAD = new Map([
  ["weather.humidity", 70],
  ["weather.sunshine", 900],
]);

/** Every read of the last `read`. */
const asked: string[] = [];

/** A core storing one humidity each way and an hour of sunshine ahead. */
function fake(): WeatherReader {
  return {
    history: perSeries((device, series: string, from: Readonly<Date>, to: Readonly<Date>) => {
      asked.push(`history ${device} ${series} ${minute(from)} ${minute(to)}`);

      const points =
        series === "weather.humidity"
          ? [{ start: at("08:00").toISOString(), end: at("09:00").toISOString(), mean: 81 }]
          : [];

      return { tier: "raw" as const, points };
    }),
    forecasts: perSeries((device, series: string, from: Readonly<Date>, to: Readonly<Date>) => {
      asked.push(`forecasts ${device} ${series} ${minute(from)} ${minute(to)}`);

      const value = AHEAD.get(series);
      const target = { issued: at("00:00").toISOString(), target: at("08:00").toISOString() };

      return { points: value === undefined ? [] : [{ ...target, value }] };
    }),
  };
}

function read() {
  asked.length = 0;

  return readWeatherSources(fake(), at("00:00"), new Date("2026-11-17T00:00:00Z"), at("13:00"));
}

test("the detail's read keeps history and forecasts apart and adds its own quantities", async () => {
  const sources = await read();
  const hour = { from: at("08:00").getTime(), to: at("09:00").getTime() };

  expect(sources.measured["weather.humidity"]).toEqual([{ ...hour, value: 81 }]);
  expect(sources.forecast["weather.humidity"]).toEqual([{ ...hour, value: 70 }]);
  expect(sources.forecast["weather.sunshine"]).toEqual([{ ...hour, value: 900 }]);
  expect(sources.measured["weather.sunshine"]).toEqual([]);
});

test("the detail's history ends where it is told: a day or less is read raw, not as hourly means", async () => {
  await read();

  for (const series of ["gusts", "apparent_temperature", "sunshine", "humidity", "cloud_cover"]) {
    expect(asked).toContain(
      `forecasts ${WEATHER} weather.${series} 2026-11-14T00:00 2026-11-17T00:00`,
    );
    expect(asked).toContain(
      `history ${WEATHER} weather.${series} 2026-11-14T00:00 2026-11-14T13:00`,
    );
  }
});

test("a detail that shows less reads only the series it names", async () => {
  asked.length = 0;

  await readWeatherSources(fake(), at("00:00"), new Date("2026-11-17T00:00:00Z"), at("13:00"), [
    "weather.code",
    "weather.sunshine",
  ]);

  expect(asked.map((line) => line.split(" ").slice(0, 3).join(" ")).toSorted()).toEqual([
    `forecasts ${WEATHER} weather.code`,
    `forecasts ${WEATHER} weather.sunshine`,
    `history ${WEATHER} weather.code`,
    `history ${WEATHER} weather.sunshine`,
  ]);
});

test("the detail's read fails on a refused series with the core's reason, and on a lost core", async () => {
  const span = [at("00:00"), new Date("2026-11-17T00:00:00Z"), at("13:00")] as const;

  const refused: WeatherReader = {
    ...fake(),
    forecasts: perSeries(() => ({ problem: "forecast.range" })),
  };

  const lost: WeatherReader = {
    ...fake(),
    history: () => Promise.reject(new TypeError("network")),
  };

  expect(await settleRead(readWeatherSources(refused, ...span))).toEqual({
    failed: true,
    refused: { problem: "forecast.range" },
  });
  expect(await settleRead(readWeatherSources(lost, ...span))).toEqual({
    failed: true,
    refused: undefined,
  });
});
