// The weather by the hour (ADR 23 "Dashboard"): today and the days after it in the plant's
// zone, as the weather detail draws them. What was measured stands for an hour; the forecast
// for the rest. Pure.
import { plantMidnight } from "../plant-day.ts";
import { codeKind } from "../weather-code.ts";
import { skyOf, type Sky } from "./sky.ts";
import { snowLies, type DetailRole, type Held, type WeatherSources } from "./weather.ts";

/** One plant hour's weather; null where nothing stored covers it. */
export interface Hour {
  /** Its start, ms since 1970. */
  readonly at: number;
  /** What its weather code says, the worst of the hour. */
  readonly sky: Sky | null;
  readonly celsius: number | null;
  /** The apparent temperature in °C. */
  readonly apparent: number | null;
  /** mm fallen in the hour. */
  readonly precipitation: number | null;
  /** cm of snow fallen in the hour. */
  readonly snowfall: number | null;
  /** Cloud cover in %. */
  readonly cloudCover: number | null;
  /** The clear-sky clearSkyIndex: measured, so past hours alone have it. */
  readonly clearSkyIndex: number | null;
  /** m/s. */
  readonly wind: number | null;
  /** The hour's strongest, m/s. */
  readonly gusts: number | null;
  /** Degrees the wind blows from: 0 north, 90 east. */
  readonly windDirection: number | null;
  /** %. */
  readonly humidity: number | null;
}

/** One plant day's weather. */
export interface WeatherDay {
  readonly start: number;
  readonly end: number;
  readonly hours: readonly Hour[];
  /** Hours of sunshine; null without any stored. */
  readonly sunshine: number | null;
  /** The deepest snow in m while snow lies; null while none does. */
  readonly snowDepth: number | null;
  /** The lowest visibility in m of the day's fog; null without fog or without a value. */
  readonly visibility: number | null;
}

const HOUR = 3_600_000;

/** The sunshine's slot: its seconds are per quarter (ADR 23). */
const SLOT = 900_000;

/** A value and how long it was in force inside a span, in ms. */
interface Part {
  readonly value: number;
  readonly ms: number;
}

function within(list: readonly Held[] | undefined, from: number, to: number): Part[] {
  return (list ?? [])
    .filter((h) => h.from < to && h.to > from)
    .map((h) => ({ value: h.value, ms: Math.min(h.to, to) - Math.max(h.from, from) }));
}

const sum = (all: readonly number[]) => all.reduce((a, b) => a + b, 0);

const mean = (parts: readonly Part[]) =>
  parts.length === 0 ? null : sum(parts.map((p) => p.value * p.ms)) / sum(parts.map((p) => p.ms));

/** What a rate per hour let fall over the time it was in force. */
const fallen = (parts: readonly Part[]) =>
  parts.length === 0 ? null : sum(parts.map((p) => (p.value * p.ms) / HOUR));

const most = (all: readonly number[]) => (all.length === 0 ? null : Math.max(...all));

const least = (all: readonly number[]) => (all.length === 0 ? null : Math.min(...all));

const values = (parts: readonly Part[]) => parts.map((p) => p.value);

const known = (all: readonly (number | null)[]) => all.filter((v) => v !== null);

/** One hour's stored weather by series: what was measured, else the forecast. */
type Stored = (role: DetailRole) => Part[];

function storedIn(sources: WeatherSources, at: number): Stored {
  return (role) => {
    const measured = within(sources.measured[role], at, at + HOUR);

    return measured.length > 0 ? measured : within(sources.forecast[role], at, at + HOUR);
  };
}

/** What an hour adds to its day's figures. */
interface Reading {
  readonly hour: Hour;
  /** Seconds of sunshine. */
  readonly sunshine: number | null;
  /** m. */
  readonly snowDepth: number | null;
  /** The lowest visibility in m while the hour's code is fog. */
  readonly fog: number | null;
}

function reading(sources: WeatherSources, at: number): Reading {
  const stored = storedIn(sources, at);
  const code = most(values(stored("weather.code")));
  const sunshine = stored("weather.sunshine");

  return {
    hour: {
      at,
      sky: skyOf({ code, cloud: null, ghi: mean(stored("weather.ghi")) }),
      celsius: mean(stored("weather.temperature")),
      apparent: mean(stored("weather.apparent_temperature")),
      precipitation: fallen(stored("weather.precipitation")),
      snowfall: fallen(stored("weather.snowfall")),
      cloudCover: mean(stored("weather.cloud_cover")),
      clearSkyIndex: mean(within(sources.measured["weather.clearness"], at, at + HOUR)),
      wind: mean(stored("weather.wind")),
      gusts: most(values(stored("weather.gusts"))),
      windDirection: stored("weather.wind_direction")[0]?.value ?? null,
      humidity: mean(stored("weather.humidity")),
    },
    // A value stands for each slot it is held over: a rollup is the mean of its slots.
    sunshine: sunshine.length === 0 ? null : sum(sunshine.map((p) => (p.value * p.ms) / SLOT)),
    snowDepth: most(values(stored("weather.snow_depth"))),
    fog: codeKind(code) === "fog" ? least(values(stored("weather.visibility"))) : null,
  };
}

function day(sources: WeatherSources, start: number, end: number): WeatherDay {
  const read: Reading[] = [];

  for (let at = start; at < end; at += HOUR) read.push(reading(sources, at));

  const sunshine = known(read.map((r) => r.sunshine));
  const depth = most(known(read.map((r) => r.snowDepth)));

  return {
    start,
    end,
    hours: read.map((r) => r.hour),
    sunshine: sunshine.length === 0 ? null : sum(sunshine) / 3600,
    snowDepth: snowLies(depth) ? depth : null,
    visibility: least(known(read.map((r) => r.fog))),
  };
}

/** The plant-local days from the one `start` begins: `count` of them. */
export function daySpans(
  zone: string,
  start: Readonly<Date>,
  count: number,
): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  let from = start.getTime();

  for (let i = 0; i < count; i += 1) {
    // Past the longest day, 25 hours, and short of the next.
    const to = plantMidnight(zone, new Date(from + 36 * HOUR)).getTime();

    spans.push([from, to]);
    from = to;
  }

  return spans;
}

/** The days the weather detail shows: today and the next two. */
export const DAYS = 3;

/** The weather of the `DAYS` plant days from `start`, a plant midnight in `zone`. */
export function hourly(sources: WeatherSources, zone: string, start: Readonly<Date>): WeatherDay[] {
  return daySpans(zone, start, DAYS).map(([from, to]) => day(sources, from, to));
}
