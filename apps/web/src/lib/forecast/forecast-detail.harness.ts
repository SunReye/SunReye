// What the PV forecast sheet's component tests share: a core storing a forecast for one
// inverter's strings, a November day at 12:30 and the two after it, and the sheet at a phone's
// width.
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { PLANT, WEATHER, type Period } from "../api/core.ts";
import { perSeries } from "../api/core.harness.ts";
import { dayRows } from "../dashboard/today.ts";
import type { AheadReader } from "./ahead-read.ts";
import ForecastDetail from "./ForecastDetail.svelte";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.parse("2026-11-14T00:00:00Z");
const NOW = START + 12.5 * HOUR;

/** A power in W by the day from today and its hour. */
type Watts = (day: number, hour: number) => number;

/** `watts` from hour `from` to before hour `to`, nothing outside. */
const band =
  (from: number, to: number, watts: number) =>
  (hour: number): number =>
    hour >= from && hour < to ? watts : 0;

/**
 * The inverter by the hour: 2 kW from 10:00 to 14:00 today, 8 kWh. Tomorrow 3 kW from 09:00 to
 * 15:00 with 5 kW at noon and 4 kW after it, 21 kWh. The day after 1 kW from 10:00 to 12:00.
 */
const AHEAD = [
  band(10, 14, 2000),
  (hour: number) => band(12, 13, 5000)(hour) || band(13, 14, 4000)(hour) || band(9, 15, 3000)(hour),
  band(10, 12, 1000),
];

/** Each day before, 500 W around the clock: 12 kWh. */
const TOTAL: Watts = (day, hour) => (day < 0 ? 500 : (AHEAD[day]?.(hour) ?? 0));

const share =
  (part: number): Watts =>
  (day, hour) =>
    TOTAL(day, hour) * part;

/** South makes half, north and east a quarter each. */
export const STRINGS = {
  "pv.power": TOTAL,
  "pv.string.power[4]": share(0.5),
  "pv.string.power[5]": share(0.25),
  "pv.string.power[7]": share(0.25),
} satisfies Record<string, Watts>;

/** South and north on input 1, east on input 2. */
export const INPUTS = {
  "pv.power": TOTAL,
  "pv.mppt.power[1]": share(0.75),
  "pv.mppt.power[2]": share(0.25),
} satisfies Record<string, Watts>;

/** Fair by day; three hours of sunshine today, one tomorrow, in seconds per hour. */
const SKY = new Map<string, Watts>(
  Object.entries({
    "weather.code": () => 1,
    "weather.ghi": (_, hour) => (hour >= 8 && hour < 16 ? 250 : 0),
    "weather.sunshine": (day, hour) =>
      (day === 0 && hour >= 11 && hour < 14) || (day === 1 && hour === 12) ? 3600 : 0,
  }),
);

const WIRING = { moduleType: 1, modules: 16, optimized: 0, tilt: 35, loss: 2, device: 1 };

const LAYOUT = {
  appliesFrom: "2026-11-01T00:00:00Z",
  warnings: [],
  strings: [
    { ...WIRING, id: 4, name: "Süd", input: 1, azimuth: 0 },
    { ...WIRING, id: 5, name: "Nord", input: 1, azimuth: 180 },
    { ...WIRING, id: 7, name: "Ost", input: 2, azimuth: -90 },
  ],
};

/** The inverter's day rollups: 15 and 10 kWh on the two days before, 3 kWh today by 12:30. */
const MEASURED = [
  [-2, 15, 24],
  [-1, 10, 24],
  [0, 3, 12.5],
] as const;

/** What the plant's PV adds to the inverter's each day: a module no layout wires, unforecast. */
const UNLAID = 6;

const iso = (at: number) => new Date(at).toISOString();

/** `watts` by the quarter hour from `from` to before `to`, as the core's forecasts. */
function targets(watts: Watts | undefined, from: number, to: number) {
  const QUARTER = HOUR / 4;
  const first = Math.ceil(from / QUARTER) * QUARTER;
  const count = watts === undefined ? 0 : Math.max(0, Math.ceil((to - first) / QUARTER));

  const points = Array.from({ length: count }, (_, i) => {
    const at = first + i * QUARTER;
    const hours = Math.floor((at - START) / HOUR);

    return {
      issued: iso(START - DAY),
      target: iso(at),
      value: watts?.(Math.floor(hours / 24), ((hours % 24) + 24) % 24) ?? 0,
    };
  });

  return { points };
}

export interface Refusing {
  /** What the core refuses the inverter's forecasts with, as asked; none while it answers. */
  code: string | undefined;
}

export const refusing: Refusing = { code: undefined };

/** A core storing `stored` for the inverter, and each read it was asked for. */
function fake(stored: Readonly<Record<string, Watts>>) {
  const asked: string[] = [];

  const core: AheadReader = {
    layout: () => Promise.resolve(LAYOUT),
    history: perSeries((device, series: string) => {
      asked.push(`history ${device} ${series}`);

      return { tier: "raw" as const, points: [] };
    }),
    forecasts: perSeries((device, series: string, from: Readonly<Date>, to: Readonly<Date>) => {
      asked.push(`forecasts ${device} ${series}`);

      if (refusing.code !== undefined && device !== WEATHER) return { problem: refusing.code };

      const of = device === WEATHER ? SKY.get(series) : stored[series];

      const read = targets(of, from.getTime(), to.getTime());

      // The core refuses a read of more than 1,500 points (ADR 9).
      return read.points.length > 1500 ? { problem: "forecast.range" } : read;
    }),
    statistics: perSeries((device, series: string, period: Period) => {
      asked.push(`statistics ${device} ${series} ${period}`);

      const extra = device === PLANT ? UNLAID : 0;

      const points = MEASURED.map(([day, kwh, hours]) => ({
        date: iso(START + day * DAY).slice(0, 10),
        start: iso(START + day * DAY),
        end: iso(START + (day + 1) * DAY),
        integral: (kwh + extra) * 1000,
        mean: ((kwh + extra) * 1000) / hours,
        hours,
      }));

      return { period, points: device === PLANT || device === 1 ? points : [] };
    }),
  };

  return { core, asked };
}

/** Today as the dashboard read it at `now`: 1.2 kW measured from 10:00 to 12:30. */
const today = (stored: Readonly<Record<string, Watts>>, now = NOW) => ({
  zone: "UTC",
  start: new Date(START),
  now: new Date(now),
  rows: dayRows(
    [{ start: iso(START + 10 * HOUR), end: iso(NOW), mean: 1200 }],
    targets(stored["pv.power"], START, START + DAY).points,
    { start: new Date(START), end: new Date(START + DAY) },
  ),
});

/** The sheet over a core storing `stored`, which refuses the inverter's forecasts with `refused`. */
export async function show(stored: Parameters<typeof fake>[0] = STRINGS, refused?: string) {
  refusing.code = refused;
  await page.viewport(390, 800);
  const { core, asked } = fake(stored);
  const screen = await render(ForecastDetail, { core, day: today(stored) });

  /** The dashboard reads today again, `minutes` after 12:30. */
  const later = (minutes: number) =>
    screen.rerender({ core, day: today(stored, NOW + minutes * 60_000) });

  return { screen, asked, later };
}
