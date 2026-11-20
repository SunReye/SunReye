// fallow-ignore-file coverage-gaps -- replays reads against a live core; run by hand with `bun run bench`.
// What the screens' reads are made of (ADR 24): their routes, plant-local times, and the reads
// several screens share, as apps/web issues them (traced 2026-11-20).

/** Issues one GET, timed and recorded; resolves to its body, `null` when refused. */
export type Read = (path: string) => Promise<string | null>;

/** What a screen's read resolves to. */
export type Body = string | null;

export interface PvString {
  readonly id: number;
  readonly device: number;
}

/** The plant as the screens see it. Times are ms since 1970. */
export interface Plant {
  readonly zone: string;
  /** The moment the screens open at. */
  readonly now: number;
  readonly inverters: readonly number[];
  readonly strings: readonly PvString[];
}

export interface Screen {
  readonly name: string;
  readonly open: (read: Read, plant: Plant) => Promise<void>;
}

/** The SPA's computed devices (`lib/api/computed-devices.ts`). */
export const PLANT = 4_294_967_294;
export const WEATHER = 4_294_967_295;
export const SPOT = 4_294_967_292;

/** The plant's energy flows, as `history/flows.ts` lists them. */
export const FLOWS: readonly string[] = [
  "pv.power",
  "load.power",
  "grid.import.power",
  "grid.export.power",
  "self.consumption.power",
  "self.supply.power",
  "battery.charge.power",
  "battery.discharge.power",
  "ev.charge.power",
];

/** `weather/weather.ts` `SERIES`, then `DETAIL`. */
export const WEATHER_ROLES: readonly string[] = [
  "clearness",
  "ghi",
  "dhi",
  "cloud_cover",
  "code",
  "precipitation",
  "snowfall",
  "snow_depth",
  "visibility",
  "wind",
  "wind_direction",
  "temperature",
  "humidity",
].map((role) => `weather.${role}`);

export const DETAIL_ROLES: readonly string[] = ["gusts", "apparent_temperature", "sunshine"].map(
  (role) => `weather.${role}`,
);

export const HOUR = 3_600_000;

export type Span = "days" | "months" | "years";

/** Plant-local midnight of the day `at` falls in, moved by `count` of `unit`. */
export function midnight(plant: Plant, at: number, count = 0, unit: Span = "days"): number {
  const day = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(plant.zone);

  return day.startOfDay().add({ [unit]: count }).epochMilliseconds;
}

/** The first plant-local midnight of the month or year `at` falls in. */
function start(plant: Plant, at: number, unit: "months" | "years"): number {
  const day = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(plant.zone);
  const first = unit === "months" ? day.with({ day: 1 }) : day.with({ month: 1, day: 1 });

  return first.startOfDay().epochMilliseconds;
}

/** The ISO weekday the screens open on: 1 for Monday. */
export const weekday = (plant: Plant): number =>
  Temporal.Instant.fromEpochMilliseconds(plant.now).toZonedDateTimeISO(plant.zone).dayOfWeek;

/** Plant-local midnight of the day the screens open on. */
export const today = (plant: Plant): number => midnight(plant, plant.now);

const at = (ms: number): string => encodeURIComponent(new Date(ms).toISOString());

const span = (series: string, from: number, to: number): string =>
  `series=${encodeURIComponent(series)}&from=${at(from)}&to=${at(to)}`;

export const history = (device: number, series: string, from: number, to: number): string =>
  `/api/v1/devices/${device}/history?${span(series, from, to)}`;

export const forecasts = (device: number, series: string, from: number, to: number): string =>
  `/api/v1/devices/${device}/forecasts?${span(series, from, to)}`;

export const statistics = (
  device: number,
  series: string,
  period: string,
  from: number,
  to: number,
): string => `/api/v1/devices/${device}/statistics?${span(series, from, to)}&period=${period}`;

export const costs = (from: number, to: number): string =>
  `/api/v1/costs?from=${at(from)}&to=${at(to)}`;

export const api = (path: string): string => `/api/v1/${path}`;

export interface Piece {
  readonly from: number;
  readonly to: number;
}

/** Spans of at most `hours` from `from` to `to`, as `rollups()` and `forecastTargets()` split. */
export function pieces(from: number, to: number, hours: number): readonly Piece[] {
  const out: Piece[] = [];

  for (let cut = from; cut < to; cut += hours * HOUR)
    out.push({ from: cut, to: Math.min(cut + hours * HOUR, to) });

  return out;
}

/** `weather/weather.ts` `readWeather`: history of all but visibility, forecasts of all but clearness. */
export async function weather(
  read: Read,
  from: number,
  to: number,
  roles = WEATHER_ROLES,
): Promise<void> {
  const reads: Promise<Body>[] = [];

  for (const role of roles) {
    if (role !== "weather.visibility") reads.push(read(history(WEATHER, role, from, to)));

    if (role !== "weather.clearness") reads.push(read(forecasts(WEATHER, role, from, to)));
  }

  await Promise.all(reads);
}

/** `history/plant-read.ts` `readPlant`: the flows by day, by hour for a day, and the load. */
export async function readPlant(
  read: Read,
  from: number,
  to: number,
  hours: boolean,
): Promise<void> {
  if (from >= to) return;

  const periods = hours ? ["day", "hour"] : ["day"];

  await Promise.all([
    ...periods.flatMap((period) =>
      FLOWS.map((flow) => read(statistics(PLANT, flow, period, from, to))),
    ),
    ...pieces(from, to, 1400 * 24).map((piece) =>
      read(history(PLANT, "load.power", piece.from, piece.to)),
    ),
  ]);
}

/** The `points` of a history, statistics or forecasts answer; none for any other. */
export function pointsOf(text: string | null): readonly unknown[] {
  const body: unknown = text === null || text === "" ? null : JSON.parse(text);

  return body instanceof Object && "points" in body && Array.isArray(body.points)
    ? body.points
    : [];
}

/** The oldest year `/records` lists. */
function oldestYear(text: string | null): number | null {
  const records: unknown = text === null ? null : JSON.parse(text);

  if (!(records instanceof Object) || !("years" in records) || !Array.isArray(records.years))
    return null;

  const oldest: unknown = records.years.at(-1);

  return oldest instanceof Object && "year" in oldest && Number.isInteger(oldest.year)
    ? Number(oldest.year)
    : null;
}

/** `history/facts.ts`: the records, then the oldest year's load by day, then its first day by hour. */
export async function facts(read: Read): Promise<void> {
  const year = oldestYear(await read(api("records")));

  if (year === null) return;

  const days = await read(
    statistics(PLANT, "load.power", "day", Date.UTC(year - 1, 11, 31), Date.UTC(year + 1, 0, 2)),
  );

  const day = pointsOf(days)[0];

  if (!(day instanceof Object) || !("start" in day) || !("end" in day)) return;

  const [from, to] = [Date.parse(String(day.start)), Date.parse(String(day.end))];

  await read(statistics(PLANT, "load.power", "hour", from, to));
}

export interface Range {
  readonly start: number;
  readonly end: number;
  readonly before: number;
}

/** The plant-local day, month or year the screens open in, and the one before it. */
export function ranges(plant: Plant, unit: Span): Range {
  const begins = unit === "days" ? today(plant) : start(plant, plant.now, unit);

  return {
    start: begins,
    end: midnight(plant, begins, 1, unit),
    before: midnight(plant, begins, -1, unit),
  };
}
