// The weather at an instant (ADR 23 "The sky"), from the weather device's history and forecasts
// (ADR 17): what the scene, the now strip and the weather detail show. Pure but for the read it
// is handed.
import type { Core } from "../api/core.ts";
import { stored } from "./stored.ts";

/** What is known of an instant's weather; null where nothing stored covers it. */
export interface Weather {
  /**
   * How closed the sky is, on the scale of the diffuse share of the global irradiance: 0 under
   * a clear sky to 1 under a closed one. The clear-sky index alone where it has a value; else
   * the diffuse share with the cloud cover while the sun gives light, and the cloud cover while
   * it gives none. Not the cloud cover itself, which an hour's `cloudCover` is.
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

const QUARTER = 15 * MINUTE;

/** The core closes a quarter's clear-sky index half a minute after its end: a read this long
 * after it is sure to hold what the core stored for it. */
const CLOSES = MINUTE;

/** The clear-sky indices of a closed and of a clear sky; between them the cloud is linear. */
const INDEX = { closed: 0.25, clear: 1 };

/** Under this global irradiance in W/m² the light tells nothing of the clouds. */
export const DARK = 1;

/** Metres of snow depth from which snow lies (ADR 23), as in the core. */
const SNOW_LIES = 0.01;

/** Whether snow `depth` m deep lies; not without a depth. */
export function snowLies(depth: number | null): depth is number {
  return depth !== null && depth >= SNOW_LIES;
}

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

export type Span = readonly [Date, Date];

/** A span's stored weather with its history and its forecasts apart. */
export interface WeatherSources {
  readonly measured: WeatherRead;
  readonly forecast: WeatherRead;
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
  const { past, ahead } = await stored(core, SERIES, { past: span, ahead: span });

  return Object.fromEntries(SERIES.map(({ role }) => [role, [...past(role), ...ahead(role)]]));
}

/**
 * A detail's read from `from` to before `to`, its sources apart: every series, or `only` those a
 * detail other than the weather's shows.
 * @param measuredTo where history ends. A day or less of it is read raw; a longer span comes as
 * hourly means, which blur the wind's direction and its gusts.
 */
export async function readWeatherSources(
  core: WeatherReader,
  from: Readonly<Date>,
  to: Readonly<Date>,
  measuredTo: Readonly<Date>,
  only?: readonly DetailRole[],
): Promise<WeatherSources> {
  const spans = { past: spanOf(from, measuredTo), ahead: spanOf(from, to) };
  const all = [...SERIES, ...DETAIL];
  const chosen = only ? all.filter((s) => only.includes(s.role)) : all;
  const { past, ahead } = await stored(core, chosen, spans);

  return {
    measured: Object.fromEntries(chosen.map(({ role }) => [role, past(role)])),
    forecast: Object.fromEntries(chosen.map(({ role }) => [role, ahead(role)])),
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

/**
 * The cloud by the forecast or the archive (ADR 23 "The sky"): the diffuse share with the cloud
 * cover. In daylight it is midway between the two, as each over-reads where the other does not:
 * the diffuse share at a low sun, whose light is diffuse under a clear sky too, and the cloud
 * cover under thin high cloud, which the sun shines through. Either alone where the other is
 * missing; at night the light tells nothing.
 */
function forecastCloud(ghi: number | null, dhi: number | null, cover: number | null) {
  const covered = cover === null ? null : clamp(cover / 100);

  if (ghi === null || dhi === null || ghi < DARK) return covered;

  const diffuse = clamp(dhi / ghi);

  return covered === null ? diffuse : (diffuse + covered) / 2;
}

/**
 * The clear-sky index that stands for `at` in a read made at `asOf`. A quarter the read is sure
 * to hold and has no index for is a null the core stored (the sun low, or snow on the modules):
 * nothing stands in for it. Past what the read is sure to hold, the latest closed quarter stands
 * until the next has closed.
 */
function indexAt(quarters: readonly Held[], at: number, asOf: number): number | null {
  const own = quarters.find(({ from, to }) => from <= at && at < to);

  if (own !== undefined) return own.value;

  // Where the last quarter the read is sure to hold ends.
  const sure = Math.floor((asOf - CLOSES) / QUARTER) * QUARTER;

  if (at < sure || at >= sure + QUARTER + CLOSES) return null;

  return quarters.findLast(({ from, to }) => from <= at && to >= sure)?.value ?? null;
}

/**
 * The weather at `at`, ms since 1970: each quantity's value in force then.
 * @param asOf when `read` was made, for an instant read later; a read of now is made at `at`.
 */
export function weatherAt(read: WeatherRead | undefined, at: number, asOf = at): Weather {
  // History is listed first, so it wins over the forecast.
  const held = (role: Role): number | null =>
    read?.[role]?.find(({ from, to }) => from <= at && at < to)?.value ?? null;

  const index = indexAt(read?.["weather.clearness"] ?? [], at, asOf);

  const [ghi, dhi, cover] = [held("weather.ghi"), held("weather.dhi"), held("weather.cloud_cover")];

  const cloud =
    index === null
      ? forecastCloud(ghi, dhi, cover)
      : clamp((INDEX.clear - index) / (INDEX.clear - INDEX.closed));

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
