/// <reference types="bun" />
import { expect, test } from "bun:test";
import { diffuseAt, irradiance, type Irradiance } from "./diffuse.ts";

const at = (time: string) => Date.parse(`2026-11-14T${time}:00Z`);

const HOURS = ["06:00", "07:00", "11:00", "12:00"] as const;

/** A forecast with a value at each of `HOURS`. */
const hourly = (...values: readonly number[]) =>
  HOURS.map((time, i) => ({
    issued: new Date(at("00:00")).toISOString(),
    target: new Date(at(time)).toISOString(),
    value: values[i] ?? 0,
  }));

const GHI = hourly(0, 40, 400, 300);
const DHI = hourly(0, 38, 60, 285);
const DAY: Irradiance = { ghi: GHI, dhi: DHI };

test("the diffuse fraction is the diffuse share of the global irradiance in force at the instant", () => {
  expect(diffuseAt(DAY, at("11:00"))).toBeCloseTo(0.15);
  expect(diffuseAt(DAY, at("11:59"))).toBeCloseTo(0.15);
  expect(diffuseAt(DAY, at("12:20"))).toBeCloseTo(0.95);
});

test("an instant no forecast hour covers has no fraction", () => {
  expect(diffuseAt(DAY, at("05:59"))).toBeNull();
  expect(diffuseAt(DAY, at("09:30"))).toBeNull();
  expect(diffuseAt(DAY, at("13:00"))).toBeNull();
  expect(diffuseAt({ ghi: [], dhi: [] }, at("12:00"))).toBeNull();
  expect(diffuseAt(undefined, at("12:00"))).toBeNull();
});

test("without sunlight there is no fraction: the night tells nothing of the clouds", () => {
  expect(diffuseAt(DAY, at("06:30"))).toBeNull();
});

test("a fraction stays between none and all, whatever the forecast's rounding", () => {
  const rounded: Irradiance = { ghi: hourly(0, 10), dhi: hourly(0, 11) };

  expect(diffuseAt(rounded, at("07:10"))).toBe(1);
});

test("the irradiance is read from the weather device's forecast for the span", async () => {
  const asked: unknown[] = [];
  const [from, to] = [new Date(at("00:00")), new Date(at("23:59"))];

  const read = await irradiance(
    {
      forecasts: (device, series, start: Readonly<Date>, end: Readonly<Date>) => {
        asked.push([device, series, start.getTime(), end.getTime()]);

        return Promise.resolve({ points: series === "weather.ghi" ? GHI : DHI });
      },
    },
    from,
    to,
  );

  expect(asked).toEqual([
    [4_294_967_295, "weather.ghi", from.getTime(), to.getTime()],
    [4_294_967_295, "weather.dhi", from.getTime(), to.getTime()],
  ]);
  expect(diffuseAt(read, at("12:20"))).toBeCloseTo(0.95);
});

test("a refused or failed read is no weather", async () => {
  const refused = await irradiance(
    { forecasts: () => Promise.resolve({ problem: "auth.forbidden" }) },
    new Date(at("00:00")),
    new Date(at("23:59")),
  );

  const failed = await irradiance(
    { forecasts: () => Promise.reject(new Error("offline")) },
    new Date(at("00:00")),
    new Date(at("23:59")),
  );

  expect(diffuseAt(refused, at("12:20"))).toBeNull();
  expect(diffuseAt(failed, at("12:20"))).toBeNull();
});
