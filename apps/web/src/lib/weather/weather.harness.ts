// What the weather read's unit tests share: a core that holds stored weather, and its points.
import type { Forecasts, History } from "../api/core.ts";
import { readWeather } from "./weather.ts";

export const WEATHER = 4_294_967_295;
export const iso = (time: string) => `2026-11-14T${time}:00Z`;
export const at = (time: string) => Date.parse(iso(time));

/** Forecast targets, as the core serves them. */
export const targets = (...values: readonly (readonly [string, number])[]) =>
  values.map(([time, value]) => ({
    issued: iso("00:00"),
    target: iso(time),
    value,
  }));

/** History intervals, as the core serves them. */
export const intervals = (...values: readonly (readonly [string, string, number])[]) =>
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
export function fake(stored: Stored) {
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

export const read = (stored: Stored) =>
  readWeather(fake(stored).core, new Date(at("00:00")), new Date(at("23:59")));
