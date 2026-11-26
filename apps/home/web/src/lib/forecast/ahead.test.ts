/// <reference types="bun" />
import { expect, test } from "bun:test";
import { settleRead } from "../api/client.ts";
import { perSeries } from "../api/core.harness.ts";
import type { Rolled } from "../history/history.ts";
import { daySpans } from "../weather/hourly.ts";
import { aheadDays, powerAt, track } from "./ahead.ts";
import { forecastTargets, held } from "./forecast.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.parse("2026-11-14T00:00:00Z");
const NOW = START + 12.5 * HOUR;

/** An hourly forecast from `days` before today to the end of the day after tomorrow, in W. */
function hourly(watts: (day: number, hour: number) => number, days = 0) {
  const points = [];

  for (let i = -days * 24; i < 72; i += 1)
    points.push({
      target: new Date(START + i * HOUR).toISOString(),
      value: watts(Math.floor(i / 24), ((i % 24) + 24) % 24),
    });

  return held(points);
}

/** `watts` from hour `from` to before hour `to`, nothing outside. */
const band =
  (from: number, to: number, watts: number) =>
  (hour: number): number =>
    hour >= from && hour < to ? watts : 0;

/** 2 kW from 10:00 to 14:00 today; 3 kW from 09:00 to 15:00 tomorrow, 5 kW at noon and 4 kW
 * after it; then nothing. */
const AHEAD = [
  band(10, 14, 2000),
  (hour: number) => band(12, 13, 5000)(hour) || band(13, 14, 4000)(hour) || band(9, 15, 3000)(hour),
  band(0, 0, 0),
];

/** Each day before, 500 W around the clock. */
const PLANT = hourly((day, hour) => (day < 0 ? 500 : (AHEAD[day]?.(hour) ?? 0)), 2);

const SPANS = daySpans("UTC", new Date(START), 3);

const line = (label: string, watts: number) => ({
  label,
  colour: "red",
  planned: hourly((day, hour) => (day === 0 && hour >= 10 && hour < 14 ? watts : 0)),
});

const days = () =>
  aheadDays({ plant: PLANT, lines: [line("south", 1500), line("north", 500)] }, SPANS, NOW);

test("today heads with what is still to come and the day's total", () => {
  const [today] = days();

  expect(today).toMatchObject({ start: START, end: START + DAY, total: 8, remaining: 3 });
  expect(today?.change).toBeNull();
});

test("a later day has its total, its peak and its change against today", () => {
  const [, tomorrow, after] = days();

  expect(tomorrow).toMatchObject({
    total: 21,
    remaining: null,
    peak: { watts: 5000, at: START + DAY + 12 * HOUR },
    change: 1.625,
  });
  expect(after).toMatchObject({ total: 0, peak: null, change: -1 });
});

test("the best window is the three consecutive hours that make the most", () => {
  const [today, tomorrow, after] = days();

  // Of equal windows the earliest.
  expect(today?.window).toEqual({ from: START + 10 * HOUR, to: START + 13 * HOUR, kwh: 6 });
  expect(tomorrow?.window).toEqual({
    from: START + DAY + 11 * HOUR,
    to: START + DAY + 14 * HOUR,
    kwh: 12,
  });
  // A day without sun has none.
  expect(after?.window).toBeNull();
});

test("each line's expected energy is its own, by the day", () => {
  const [today, tomorrow] = days();

  expect(today?.lines.map((l) => [l.label, l.kwh])).toEqual([
    ["south", 6],
    ["north", 2],
  ]);
  expect(tomorrow?.lines.map((l) => l.kwh)).toEqual([0, 0]);
});

/** A day rollup of `kwh`, read over `hours` of it. */
const rolled = (day: number, kwh: number, hours = 24): Rolled => ({
  start: START + day * DAY,
  end: START + (day + 1) * DAY,
  integral: kwh * 1000,
  mean: (kwh * 1000) / hours,
  max: null,
  covered: hours * HOUR,
});

test("today so far is measured against its forecast; the accuracy judges whole past days", () => {
  // 12 kWh forecast on each past day: 15 and 10 kWh measured. Today 3 of 5 kWh by 12:30.
  const judged = track("UTC", NOW, [rolled(-2, 15), rolled(-1, 10), rolled(0, 3, 12.5)], PLANT);

  expect(judged.sofar).toBeCloseTo(-0.4);
  expect(judged.accuracy.days).toBe(2);
  expect(judged.accuracy.error).toBeCloseTo((0.25 + 1 / 6) / 2);
});

/** 1.5 kW from 08:00 to 15:00, then 0.4 kW to 17:00: 11.3 kWh a day. */
const NOVEMBER = (hour: number) =>
  hour >= 8 && hour < 15 ? 1500 : hour >= 15 && hour < 17 ? 400 : 0;

test("a day whose forecast begins in its evening is left out, however few hours were measured", () => {
  // `NOVEMBER` from four days before today on. The first stored target is that first day's 15:00,
  // when the layout came in: 0.8 kWh forecast there. Readings cover the 9 daylight hours alone,
  // as when the plant reads nothing at night.
  const firstTarget = START - 4 * DAY + 15 * HOUR;
  const points = [];

  for (let at = firstTarget; at < START + 3 * DAY; at += HOUR)
    points.push({
      target: new Date(at).toISOString(),
      value: NOVEMBER(new Date(at).getUTCHours()),
    });

  const measured = [-4, -3, -2, -1].map((d) => rolled(d, d === -4 ? 7.872 : 11.3, 9));
  const judged = track("UTC", NOW, measured, held(points));

  // Judged against its 0.8 kWh evening, the first day alone would read 884 % off and the four
  // days 221 %, the figure the live plant showed.
  expect(judged.accuracy.days).toBe(3);
  expect(judged.accuracy.error).toBeCloseTo(0);
});

test("without a measurement today there is nothing to set against the forecast", () => {
  const judged = track("UTC", NOW, [], PLANT);

  expect(judged.sofar).toBeNull();
  expect(judged.accuracy).toMatchObject({ error: null, days: 0 });
});

test("a forecast's power holds from its target to the next", () => {
  expect(powerAt(PLANT, START + 11.25 * HOUR)).toBe(2000);
  expect(powerAt(PLANT, START + 14 * HOUR)).toBe(0);
  // Past the last target's hour nothing is forecast.
  expect(powerAt(PLANT, START + 3 * DAY)).toBeNull();
});

test("a read refused in any of its pieces fails with the core's reason, never one with a hole", async () => {
  const asked: number[] = [];

  const core = {
    forecasts: perSeries((_device: number, _series: string, from: Readonly<Date>) => {
      asked.push(from.getTime());

      return asked.length === 2
        ? { problem: "forecast.range" }
        : { points: [{ target: from.toISOString(), issued: from.toISOString(), value: 1 }] };
    }),
  };

  const read = await settleRead(
    forecastTargets(core, 1, "pv.power", new Date(START), new Date(START + 33 * DAY)),
  );

  expect(asked).toHaveLength(3);
  expect(read).toEqual({ failed: true, refused: { problem: "forecast.range" } });
});
