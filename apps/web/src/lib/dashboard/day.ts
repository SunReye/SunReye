// Reads today from the core: the plant's energy from its rollups, the PV forecast, the day's prices, the weather
// and the money (ADR 12, 14, 15, 17). Nothing here is live; the dashboard rereads each part as
// often as it moves.
import { PLANT, SPOT, type Core } from "../api/core.ts";
import type { CostDays } from "../api/tariff.ts";
import { plantMidnight } from "../plant-day.ts";
import {
  combined,
  dayRows,
  forecastPv,
  peak,
  today,
  type DayRow,
  type Energies,
  type Interval,
  type Target,
  type Today,
} from "./today.ts";
import { weatherNow } from "../weather/now.ts";
import { weatherAt, type Weather } from "../weather/weather.ts";

const HOUR = 3_600_000;

export interface Day {
  /** The plant's IANA zone, which cuts its days (ADR 3). */
  readonly zone: string;
  /** When it was read. */
  readonly now: Date;
  readonly start: Date;
  readonly end: Date;
  readonly today: Today;
  readonly rows: readonly DayRow[];
  /** kWh. */
  readonly pv: { readonly total: number; readonly remaining: number };
  /** The day's spot prices in EUR/kWh, each from its slot's start; none without the spot-price device. */
  readonly prices: readonly Target[];
  /** As of the quarter's read of the weather now, which the scene shares. */
  readonly weather: Weather;
  /** EUR; null when the core refused, as without a tariff. */
  readonly money: Readonly<CostDays["total"]> | null;
}

export type Reader = Readonly<
  Pick<Core, "timezone" | "history" | "statistics" | "forecasts" | "layout" | "costs">
>;

async function measured(core: Reader, series: string, from: Date, to: Date): Promise<Interval[]> {
  // An empty range, the first instant of a day, is refused: nothing to read yet.
  if (to <= from) return [];

  const read = await core.history(PLANT, series, from, to);

  return "points" in read ? read.points : [];
}

/** A `plant` power's day energy in kWh, rolled up by the core to its latest reading (ADR 3). */
async function rolledUp(core: Reader, series: keyof Energies, day: readonly [Date, Date]) {
  const read = await core.statistics(PLANT, series, "day", ...day);

  // Wh; a day without a reading has no figures.
  return ("points" in read ? (read.points[0]?.integral ?? 0) : 0) / 1000;
}

async function energies(core: Reader, day: readonly [Date, Date]): Promise<Energies> {
  const [pv, load, imported, exported, pvOnSite, loadOnSite] = await Promise.all([
    rolledUp(core, "pv.power", day),
    rolledUp(core, "load.power", day),
    rolledUp(core, "grid.import.power", day),
    rolledUp(core, "grid.export.power", day),
    rolledUp(core, "self.consumption.power", day),
    rolledUp(core, "self.supply.power", day),
  ]);

  return {
    "pv.power": pv,
    "load.power": load,
    "grid.import.power": imported,
    "grid.export.power": exported,
    "self.consumption.power": pvOnSite,
    "self.supply.power": loadOnSite,
  };
}

async function forecast(
  core: Reader,
  device: number,
  series: string,
  from: Date,
  to: Date,
): Promise<readonly Target[]> {
  const read = await core.forecasts(device, series, from, to);

  return "points" in read ? read.points : [];
}

/** Every inverter the layout wires a string to. */
async function inverters(core: Reader): Promise<readonly number[]> {
  const layout = await core.layout();

  if (!("strings" in layout)) return [];

  const devices = new Set<number>();

  for (const string of layout.strings) devices.add(string.device);

  return [...devices];
}

/** The weather now, as the scene shows it: both share the quarter's read. */
async function weatherOf(core: Reader, now: Readonly<Date>): Promise<Weather> {
  return weatherAt(...(await weatherNow(core, now.getTime())));
}

/** Which day is today in the plant's zone. */
export interface Place {
  readonly zone: string;
  readonly start: Date;
  readonly end: Date;
}

/** The forecasts, which move each hour. */
export interface Hourly {
  readonly pv: readonly Target[];
  readonly prices: readonly Target[];
}

/** The measured powers the day chart draws and the weather now, which move each quarter. */
export interface Quarterly {
  readonly pv: readonly Interval[];
  readonly load: readonly Interval[];
  readonly weather: Weather;
}

/** Today's energies and money, which move each minute. */
export interface Moving {
  readonly energies: Energies;
  readonly money: Day["money"];
}

/** Everything today is made of, as last read. */
export interface Reads {
  readonly place: Place;
  readonly hourly: Hourly;
  readonly quarterly: Quarterly;
  readonly moving: Moving;
}

/** Today in the plant's zone at `now`. */
async function readPlace(core: Reader, now: Readonly<Date>): Promise<Place> {
  const zone = await core.timezone();
  // Unread, the viewer's own zone stands in.
  const name = "name" in zone ? zone.name : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = plantMidnight(name, now);
  // Past the longest day, 25 hours, and short of the next.
  const end = plantMidnight(name, new Date(start.getTime() + 36 * HOUR));

  return { zone: name, start, end };
}

export async function readHourly(core: Reader, { start, end }: Readonly<Place>): Promise<Hourly> {
  const [pv, prices] = await Promise.all([
    inverters(core).then(async (ids) =>
      combined(await Promise.all(ids.map((id) => forecast(core, id, "pv.power", start, end)))),
    ),
    forecast(core, SPOT, "price.spot", start, end),
  ]);

  return { pv, prices };
}

export async function readQuarterly(
  core: Reader,
  { start }: Readonly<Place>,
  now: Readonly<Date>,
): Promise<Quarterly> {
  const read = new Date(now.getTime());

  const [pv, load, weather] = await Promise.all([
    measured(core, "pv.power", start, read),
    measured(core, "load.power", start, read),
    weatherOf(core, read),
  ]);

  return { pv, load, weather };
}

export async function readMoving(core: Reader, { start, end }: Readonly<Place>): Promise<Moving> {
  const [day, costs] = await Promise.all([energies(core, [start, end]), core.costs(start, end)]);

  return { energies: day, money: "total" in costs ? costs.total : null };
}

/** Today as of `now`, from what was read of it. */
export function dayOf(
  { place, hourly, quarterly, moving }: Readonly<Reads>,
  now: Readonly<Date>,
): Day {
  const { start, end } = place;
  const { pv, load } = quarterly;

  return {
    zone: place.zone,
    now: new Date(now.getTime()),
    start,
    end,
    today: today(moving.energies, { production: peak(pv), consumption: peak(load) }),
    rows: dayRows(pv, hourly.pv, { start, end }),
    pv: forecastPv(hourly.pv, now),
    prices: hourly.prices,
    weather: quarterly.weather,
    money: moving.money,
  };
}

/** Everything today is made of, read at `now`. */
export async function readAll(core: Reader, now: Readonly<Date>): Promise<Reads> {
  const place = await readPlace(core, now);

  const [hourly, quarterly, moving] = await Promise.all([
    readHourly(core, place),
    readQuarterly(core, place, now),
    readMoving(core, place),
  ]);

  return { place, hourly, quarterly, moving };
}

/** Today in the plant's zone, as of `now`. */
export async function readDay(core: Reader, now: Readonly<Date>): Promise<Day> {
  return dayOf(await readAll(core, now), now);
}
