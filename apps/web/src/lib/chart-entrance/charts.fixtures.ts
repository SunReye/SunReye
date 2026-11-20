// What the charts draw in the chart entrance's tests: a June day from midnight UTC.
import type { Day } from "../dashboard/day.ts";
import type { DayRow } from "../dashboard/today.ts";
import type { FoldRow } from "../explore/fold.ts";
import type { Band } from "../range/bands.ts";
import type { Hour } from "../weather/hourly.ts";

export const HOUR = 3_600_000;
export const T0 = Date.UTC(2026, 5, 1);

const hour = (i: number): Hour => ({
  at: T0 + i * HOUR,
  sky: null,
  celsius: 10 + i,
  apparent: 9 + i,
  precipitation: i % 3,
  snowfall: 0,
  cloudCover: 50,
  clearSkyIndex: 0.5,
  wind: 3,
  gusts: 5,
  windDirection: 90,
  humidity: 60,
});

/** The day's hours, some wet. */
export const hours = Array.from({ length: 24 }, (_, i) => hour(i));

const band = (i: number): Band => ({
  key: `b${i}`,
  label: `${i}`,
  tick: true,
  title: `${i}`,
  state: "data",
  partial: false,
  up: [20 + i * 10],
  down: [30],
  drillable: false,
});

export const bands = [band(0), band(1), band(2)];

/** The day's PV by the quarter hour. */
export const dayRows: DayRow[] = Array.from({ length: 96 }, (_, i) => ({
  time: new Date(T0 + (i * HOUR) / 4),
  actual: i,
  forecast: i + 1,
}));

/** The day's spot prices by the hour, the night's below zero. */
export const priceDay: Pick<Day, "zone" | "now" | "start" | "end" | "prices"> = {
  zone: "UTC",
  now: new Date(T0 + 12 * HOUR),
  start: new Date(T0),
  end: new Date(T0 + 24 * HOUR),
  prices: Array.from({ length: 24 }, (_, i) => ({
    target: new Date(T0 + i * HOUR).toISOString(),
    value: (i - 3) / 100,
  })),
};

/** A week folded by the day. */
export const week: FoldRow[] = Array.from({ length: 7 }, (_, i) => ({
  key: `${i}`,
  start: T0 + i * 24 * HOUR,
  end: T0 + (i + 1) * 24 * HOUR,
  day: 0,
  mean: 100 + i,
  min: 50,
  max: 200,
  energy: null,
  delta: null,
  hours: 24,
}));
