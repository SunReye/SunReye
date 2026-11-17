// The weather at an instant (ADR 23 "The sky"), from the weather device's history and forecasts
// (ADR 17): what the scene, the now strip and the weather detail show. Pure but for the read it
// is handed.
import { WEATHER, type Core } from "../api/core.ts";

/** What is known of an instant's weather; null where nothing stored covers it. */
export interface Weather {
  /**
   * How closed the sky is, on the scale of the diffuse share of the global irradiance: 0 under
   * a clear sky to 1 under a closed one. The clear-sky index where it has a value; else the
   * diffuse share while the sun gives light, and the cloud cover while it gives none.
   */
  readonly cloud: number | null;
  /** The WMO weather code. */
  readonly code: number | null;
  /** mm/h. */
  readonly precipitation: number | null;
  /** cm/h. */
  readonly snowfall: number | null;
  /** m. */
  readonly snowDepth: number | null;
  /** m; forecasts alone have it. */
  readonly visibility: number | null;
  /** m/s. */
  readonly wind: number | null;
  /** Degrees it blows from: 0 north, 90 east. */
  readonly windDirection: number | null;
  readonly celsius: number | null;
  /** Global horizontal irradiance in W/m²: under 1 it is night. */
  readonly ghi: number | null;
}

const MINUTE = 60_000;

/** A forecast value is in force this long at most: the hourly quantities' step. */
const STEP = 60 * MINUTE;

/** The core closes a quarter's clear-sky index half a minute after its end, so the last one
 * stands for now until the next has closed: a quarter and that lag. */
const INDEX_STANDS = 20 * MINUTE;

/** The clear-sky indices of a closed and of a clear sky; between them the cloud is linear. */
const INDEX = { closed: 0.25, clear: 1 };

/** Under this global irradiance in W/m² the light tells nothing of the clouds. */
export const DARK = 1;

/** Each stored series the weather is read from, and where the core has it. */
const SERIES = {
  index: { role: "weather.clearness", history: true, forecasts: false },
  ghi: { role: "weather.ghi", history: true, forecasts: true },
  dhi: { role: "weather.dhi", history: true, forecasts: true },
  cover: { role: "weather.cloud_cover", history: true, forecasts: true },
  code: { role: "weather.code", history: true, forecasts: true },
  precipitation: {
    role: "weather.precipitation",
    history: true,
    forecasts: true,
  },
  snowfall: { role: "weather.snowfall", history: true, forecasts: true },
  snowDepth: { role: "weather.snow_depth", history: true, forecasts: true },
  // The archive has none (ADR 23).
  visibility: { role: "weather.visibility", history: false, forecasts: true },
  wind: { role: "weather.wind", history: true, forecasts: true },
  windDirection: {
    role: "weather.wind_direction",
    history: true,
    forecasts: true,
  },
  celsius: { role: "weather.temperature", history: true, forecasts: true },
} as const;

type Name = keyof typeof SERIES;

const NAMES = Object.keys(SERIES) as Name[];

/** A value from `from` to before `to`, in ms since 1970. */
interface Held {
  readonly from: number;
  readonly to: number;
  readonly value: number;
}

/** A span's stored weather: hand it to `weatherAt`. History comes before forecasts. */
export type WeatherRead = Readonly<Record<Name, readonly Held[]>>;

type Reader = Pick<Core, "history" | "forecasts">;

async function measured(
  core: Reader,
  name: Name,
  from: Date,
  to: Date,
): Promise<Held[]> {
  const read = await core.history(WEATHER, SERIES[name].role, from, to);

  return "points" in read
    ? read.points.map(({ start, end, mean }) => ({
        from: Date.parse(start),
        to: Date.parse(end),
        value: mean,
      }))
    : [];
}

async function forecast(
  core: Reader,
  name: Name,
  from: Date,
  to: Date,
): Promise<Held[]> {
  const read = await core.forecasts(WEATHER, SERIES[name].role, from, to);

  if (!("points" in read)) return [];

  const begun = read.points.map(({ target }) => Date.parse(target));

  return read.points.map(({ value }, i) => {
    const start = begun[i] ?? 0;

    return {
      from: start,
      to: Math.min(begun[i + 1] ?? Infinity, start + STEP),
      value,
    };
  });
}

/** The stored weather from `from` to before `to`; a series the core refuses or fails is empty. */
export async function readWeather(
  core: Reader,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<WeatherRead> {
  const span = [new Date(from.getTime()), new Date(to.getTime())] as const;

  const stored = await Promise.all(
    NAMES.map(async (name) => {
      const { history, forecasts } = SERIES[name];

      const sources = await Promise.all(
        [
          history && measured(core, name, ...span),
          forecasts && forecast(core, name, ...span),
        ]
          .filter((source) => source !== false)
          .map((source) => source.catch((): Held[] => [])),
      );

      return [name, sources.flat()] as const;
    }),
  );

  return Object.fromEntries(stored) as WeatherRead;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The weather at `at`, ms since 1970: each quantity's value in force then. */
export function weatherAt(read: WeatherRead | undefined, at: number): Weather {
  // History is listed first, so it wins over the forecast.
  const held = (name: Name): number | null =>
    read?.[name].find(({ from, to }) => from <= at && at < to)?.value ?? null;

  // The latest quarter that stands: the one before yields once the next has closed.
  const index =
    read?.index.findLast(({ from, to }) => from <= at && at < to + INDEX_STANDS)
      ?.value ?? null;

  const [ghi, dhi, cover] = [held("ghi"), held("dhi"), held("cover")];

  let cloud = cover === null ? null : clamp(cover / 100);

  if (ghi !== null && dhi !== null && ghi >= DARK) cloud = clamp(dhi / ghi);

  if (index !== null)
    cloud = clamp((INDEX.clear - index) / (INDEX.clear - INDEX.closed));

  return {
    cloud,
    code: held("code"),
    precipitation: held("precipitation"),
    snowfall: held("snowfall"),
    snowDepth: held("snowDepth"),
    visibility: held("visibility"),
    wind: held("wind"),
    windDirection: held("windDirection"),
    celsius: held("celsius"),
    ghi,
  };
}
