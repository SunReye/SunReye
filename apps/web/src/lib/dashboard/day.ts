// Reads today from the core: the plant's energy from its rollups, the PV forecast, the day's prices, the weather
// and the money (ADR 12, 14, 15, 17). Nothing here is live; the dashboard rereads it.
import type { Core } from "../api/core.ts";
import type { CostDays } from "../api/tariff.ts";
import { plantMidnight } from "../plant-day.ts";
import { current, sky, type Sky } from "./now.ts";
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

/** The computed devices' fixed ids (ADR 15). */
const WEATHER = 4_294_967_295;
export const PLANT = 4_294_967_294;
export const TARIFF = 4_294_967_293;
export const SPOT = 4_294_967_292;

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
  readonly weather: { readonly celsius: number | null; readonly sky: Sky | null };
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

/** A `plant` power's day energy in kWh, rolled up by the core over the day's closed hours (ADR 3). */
async function rolledUp(core: Reader, series: keyof Energies, day: readonly [Date, Date]) {
  const read = await core.statistics(PLANT, series, "day", ...day);

  // Wh; a day without a closed hour has no figures yet.
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

async function weatherNow(core: Reader, now: Readonly<Date>) {
  const around = [new Date(now.getTime() - HOUR), new Date(now.getTime() + HOUR)] as const;

  const [celsius = null, ghi = null, dhi = null] = await Promise.all(
    ["weather.temperature", "weather.ghi", "weather.dhi"].map(async (series) =>
      current(await forecast(core, WEATHER, series, ...around), now),
    ),
  );

  return {
    celsius,
    sky: ghi === null || dhi === null ? null : sky({ ghi, dhi }),
  };
}

/** Today in the plant's zone, as of `now`. */
export async function readDay(core: Reader, now: Readonly<Date>): Promise<Day> {
  const read = new Date(now.getTime());
  const zone = await core.timezone();
  // Unread, the viewer's own zone stands in.
  const name = "name" in zone ? zone.name : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = plantMidnight(name, now);
  // Past the longest day, 25 hours, and short of the next.
  const end = plantMidnight(name, new Date(start.getTime() + 36 * HOUR));

  const [pv, load, day, pvForecast, prices, weather, costs] = await Promise.all([
    measured(core, "pv.power", start, read),
    measured(core, "load.power", start, read),
    energies(core, [start, end]),
    inverters(core).then(async (ids) =>
      combined(await Promise.all(ids.map((id) => forecast(core, id, "pv.power", start, end)))),
    ),
    forecast(core, SPOT, "price.spot", start, end),
    weatherNow(core, read),
    core.costs(start, end),
  ]);

  return {
    zone: name,
    now: read,
    start,
    end,
    today: today(day, { production: peak(pv), consumption: peak(load) }),
    rows: dayRows(pv, pvForecast, { start, end }),
    pv: forecastPv(pvForecast, read),
    prices,
    weather,
    money: "total" in costs ? costs.total : null,
  };
}
