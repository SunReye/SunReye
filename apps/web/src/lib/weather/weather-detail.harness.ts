// What the weather detail's component tests share: a core that holds stored weather by the hour,
// a mild November day and the two after it, and the detail shown at a phone's width.
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { perSeries as eachSeries } from "../api/core.harness.ts";
import type { WeatherReader } from "./weather.ts";
import WeatherDetail from "./WeatherDetail.svelte";

export const WEATHER = 4_294_967_295;
const HOUR = 3_600_000;
const START = Date.parse("2026-11-14T00:00:00Z");

/** A value per hour of the three days; null leaves a gap. */
type Series = readonly (number | null)[];

/** A series from each hour's index. */
export const each = (of: (hour: number) => number | null): readonly (number | null)[] =>
  Array.from({ length: 72 }, (_, i) => of(i));

interface Stored {
  readonly history?: Readonly<Record<string, Series>>;
  readonly forecasts?: Readonly<Record<string, Series>>;
}

/** A core holding `stored`, and each device it was asked for. */
function fake(stored: Stored) {
  const devices: number[] = [];

  const hours = (
    source: keyof Stored,
    series: string,
  ): readonly Readonly<{ at: number; value: number }>[] =>
    (stored[source]?.[series] ?? []).flatMap((value, i) =>
      value === null ? [] : [{ at: START + i * HOUR, value }],
    );

  const core: WeatherReader = {
    history: eachSeries((device, series: string) => {
      devices.push(device);

      return {
        tier: "hour" as const,
        points: hours("history", series).map(({ at, value }) => ({
          start: new Date(at).toISOString(),
          end: new Date(at + HOUR).toISOString(),
          mean: value,
        })),
      };
    }),
    forecasts: eachSeries((device, series: string) => {
      devices.push(device);

      return {
        points: hours("forecasts", series).map(({ at, value }) => ({
          issued: new Date(START).toISOString(),
          target: new Date(at).toISOString(),
          value,
        })),
      };
    }),
  };

  return { core, devices };
}

/** The dashboard's read: a fair sky now. */
const DAY = {
  zone: "UTC",
  start: new Date(START),
  now: new Date(START + 12.5 * HOUR),
  weather: {
    cloud: 0.5,
    code: 1,
    precipitation: 0,
    snowfall: 0,
    snowDepth: 0,
    visibility: 24_000,
    wind: 3,
    windDirection: 270,
    celsius: 7,
    humidity: 80,
    ghi: 250,
    clearSkyIndex: null,
    dry: null,
  },
};

/** A mild November day and the two after: overcast mornings, some sun, a westerly. */
export const DRY = {
  "weather.code": each((h) => (h % 24 < 10 ? 3 : 1)),
  "weather.ghi": each((h) => (h % 24 >= 8 && h % 24 < 16 ? 250 : 0)),
  "weather.temperature": each((h) => 4 + (h % 24) / 4),
  "weather.apparent_temperature": each((h) => 2 + (h % 24) / 4),
  "weather.precipitation": each(() => 0),
  "weather.snowfall": each(() => 0),
  "weather.snow_depth": each(() => 0),
  "weather.visibility": each(() => 24_000),
  "weather.cloud_cover": each((h) => (h % 24 < 10 ? 100 : 30)),
  "weather.wind": each(() => 3),
  "weather.gusts": each(() => 7),
  "weather.wind_direction": each(() => 270),
  "weather.humidity": each(() => 80),
  // Three sunny hours today, one tomorrow, in seconds per hour.
  "weather.sunshine": each((h) => ((h >= 11 && h < 14) || h === 36 ? 3600 : 0)),
} satisfies Record<string, Series>;

export async function show(stored: Parameters<typeof fake>[0]) {
  await page.viewport(390, 800);
  const { core, devices } = fake(stored);
  const screen = await render(WeatherDetail, { core, day: DAY });

  return { screen, devices };
}
