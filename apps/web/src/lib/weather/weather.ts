// The weather at an instant (ADR 23 "The sky"), from the weather device's history and forecasts
// (ADR 17): what the scene, the now strip and the weather detail show. Pure but for the read it
// is handed.
import { WEATHER, type Core, type Forecasts, type History } from "../api/core.ts";

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
  /** Relative, in %. */
  readonly humidity: number | null;
  /** Global horizontal irradiance in W/m²: under 1 it is night. */
  readonly ghi: number | null;
  /** The clear-sky index that stands for the instant: null where the core measured none. */
  readonly clearSkyIndex: number | null;
  /** Ms since precipitation last fell, 0 while it falls; null where none fell in what was read. */
  readonly dry: number | null;
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
const SERIES = [
  { role: "weather.clearness", history: true, forecasts: false },
  { role: "weather.ghi", history: true, forecasts: true },
  { role: "weather.dhi", history: true, forecasts: true },
  { role: "weather.cloud_cover", history: true, forecasts: true },
  { role: "weather.code", history: true, forecasts: true },
  { role: "weather.precipitation", history: true, forecasts: true },
  { role: "weather.snowfall", history: true, forecasts: true },
  { role: "weather.snow_depth", history: true, forecasts: true },
  // The archive has none (ADR 23).
  { role: "weather.visibility", history: false, forecasts: true },
  { role: "weather.wind", history: true, forecasts: true },
  { role: "weather.wind_direction", history: true, forecasts: true },
  { role: "weather.temperature", history: true, forecasts: true },
  { role: "weather.humidity", history: true, forecasts: true },
] as const;

/** What the weather detail reads besides (ADR 23 "Dashboard"). */
const DETAIL = [
  { role: "weather.gusts", history: true, forecasts: true },
  { role: "weather.apparent_temperature", history: true, forecasts: true },
  { role: "weather.sunshine", history: true, forecasts: true },
] as const;

type Role = (typeof SERIES)[number]["role"];

/** A series the weather detail reads. */
export type DetailRole = (typeof SERIES | typeof DETAIL)[number]["role"];

/** A value from `from` to before `to`, in ms since 1970. */
export interface Held {
  readonly from: number;
  readonly to: number;
  readonly value: number;
}

/** A span's stored weather, by series: hand it to `weatherAt`. History comes before forecasts. */
export type WeatherRead = Readonly<Record<string, readonly Held[]>>;

export type WeatherReader = Pick<Core, "history" | "forecasts">;

type Span = readonly [Date, Date];

type Interval = History["points"][number];

type Target = Forecasts["points"][number];

/** A span's stored weather with its history and its forecasts apart. */
export interface WeatherSources {
  readonly measured: WeatherRead;
  readonly forecast: WeatherRead;
}

async function measured(core: WeatherReader, role: DetailRole, span: Span): Promise<Held[]> {
  const read = await core.history(WEATHER, role, ...span);

  return "points" in read
    ? read.points.map(({ start, end, mean }: Readonly<Interval>) => ({
        from: Date.parse(start),
        to: Date.parse(end),
        value: mean,
      }))
    : [];
}

async function forecast(core: WeatherReader, role: DetailRole, span: Span): Promise<Held[]> {
  const read = await core.forecasts(WEATHER, role, ...span);

  if (!("points" in read)) return [];

  const begun = read.points.map(({ target }: Readonly<Target>) => Date.parse(target));

  return read.points.map(({ value }: Readonly<Target>, i) => {
    const start = begun[i] ?? 0;

    return { from: start, to: Math.min(begun[i + 1] ?? Infinity, start + STEP), value };
  });
}

/** One source of a series; a read the core refuses or fails is empty. */
async function source(wanted: boolean, read: () => Promise<Held[]>): Promise<Held[]> {
  if (!wanted) return [];

  try {
    return await read();
  } catch {
    return [];
  }
}

/** One series from both sources. */
type Stored = Readonly<{ role: DetailRole; past: readonly Held[]; ahead: readonly Held[] }>;

/** Each of `series` from both sources; a series the core refuses or fails is empty. */
function stored(
  core: WeatherReader,
  series: readonly (typeof SERIES | typeof DETAIL)[number][],
  spans: Readonly<{ past: Span; ahead: Span }>,
): Promise<readonly Stored[]> {
  return Promise.all(
    series.map(async ({ role, history, forecasts }) => {
      const [past, ahead] = await Promise.all([
        source(history, () => measured(core, role, spans.past)),
        source(forecasts, () => forecast(core, role, spans.ahead)),
      ]);

      return { role, past, ahead };
    }),
  );
}

const spanOf = (from: Readonly<Date>, to: Readonly<Date>): Span => [
  new Date(from.getTime()),
  new Date(to.getTime()),
];

/** The stored weather from `from` to before `to`; a series the core refuses or fails is empty. */
export async function readWeather(
  core: WeatherReader,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<WeatherRead> {
  const span = spanOf(from, to);
  const read = await stored(core, SERIES, { past: span, ahead: span });

  return Object.fromEntries(read.map(({ role, past, ahead }) => [role, [...past, ...ahead]]));
}

/**
 * The weather detail's read from `from` to before `to`: every series, its sources apart.
 * @param measuredTo where history ends. A day or less of it is read raw; a longer span comes as
 * hourly means, which blur the wind's direction and its gusts.
 */
export async function readWeatherSources(
  core: WeatherReader,
  from: Readonly<Date>,
  to: Readonly<Date>,
  measuredTo: Readonly<Date>,
): Promise<WeatherSources> {
  const spans = { past: spanOf(from, measuredTo), ahead: spanOf(from, to) };
  const read = await stored(core, [...SERIES, ...DETAIL], spans);

  return {
    measured: Object.fromEntries(read.map(({ role, past }) => [role, past])),
    forecast: Object.fromEntries(read.map(({ role, ahead }) => [role, ahead])),
  };
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** How long it has been dry at `at`: history's quarters count over the forecast's for them. */
function dryAt(fallen: readonly Held[], at: number): number | null {
  const ends = fallen.flatMap((held) => {
    const fell = held.value > 0 && held.from <= at;
    const counts = fallen.find(({ from, to }) => from <= held.from && held.from < to) === held;

    return fell && counts ? [held.to] : [];
  });

  return ends.length === 0 ? null : Math.max(0, at - Math.max(...ends));
}

/** The weather at `at`, ms since 1970: each quantity's value in force then. */
export function weatherAt(read: WeatherRead | undefined, at: number): Weather {
  // History is listed first, so it wins over the forecast.
  const held = (role: Role): number | null =>
    read?.[role]?.find(({ from, to }) => from <= at && at < to)?.value ?? null;

  // The latest quarter that stands: the one before yields once the next has closed.
  const index =
    read?.["weather.clearness"]?.findLast(({ from, to }) => from <= at && at < to + INDEX_STANDS)
      ?.value ?? null;

  const [ghi, dhi, cover] = [held("weather.ghi"), held("weather.dhi"), held("weather.cloud_cover")];

  let cloud = cover === null ? null : clamp(cover / 100);

  if (ghi !== null && dhi !== null && ghi >= DARK) cloud = clamp(dhi / ghi);

  if (index !== null) cloud = clamp((INDEX.clear - index) / (INDEX.clear - INDEX.closed));

  return {
    cloud,
    code: held("weather.code"),
    precipitation: held("weather.precipitation"),
    snowfall: held("weather.snowfall"),
    snowDepth: held("weather.snow_depth"),
    visibility: held("weather.visibility"),
    wind: held("weather.wind"),
    windDirection: held("weather.wind_direction"),
    celsius: held("weather.temperature"),
    humidity: held("weather.humidity"),
    ghi,
    clearSkyIndex: index,
    dry: dryAt(read?.["weather.precipitation"] ?? [], at),
  };
}
