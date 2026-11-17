// What the EV and loadpoint sheets say of their range (ADR 21 "Sheet content"): the sessions, blocks
// of charging found in the hourly rollups of the charging power, and the share of the charge PV met.
// The core publishes no PV-to-EV flow (ADR 14), so each hour's charge takes the share of the house
// load PV met directly in it, the autarky sheet's PV bar: the EV is part of the house load. Pure.
import type { Rolled } from "../history/history.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { plantNow } from "../plant-day.ts";
import { shortDay } from "../range/calendar.ts";

/** A block of charging, in ms since the epoch, with its energy. */
export interface Session {
  readonly start: number;
  readonly end: number;
  readonly kwh: number;
}

/** An hour below this many Wh charged nothing: a car's standby, not a session. */
const FLOOR_WH = 50;

/** A run of charging hours, in ms and Wh. */
interface Run {
  start: number;
  end: number;
  wh: number;
}

/**
 * The sessions in `rolled`, hourly rollups of the charging power, newest first: each a run of
 * consecutive hours that charged, ending no later than `until`.
 */
export function sessionsOf(rolled: readonly Rolled[], until: number): Session[] {
  const runs: Run[] = [];

  for (const r of rolled) {
    if (r.integral < FLOOR_WH) continue;

    // An hour below the floor, or one not read, lies between two runs, so they do not meet.
    const open = runs.at(-1);

    if (open?.end === r.start) {
      open.end = r.end;
      open.wh += r.integral;
    } else runs.push({ start: r.start, end: r.end, wh: r.integral });
  }

  return runs
    .map((s: Readonly<Run>) => ({
      start: s.start,
      end: Math.min(s.end, until),
      kwh: s.wh / 1000,
    }))
    .toReversed();
}

/** An instant's clock time in the plant's zone: "7:00". */
const clockOf = (at: number, zone: string) =>
  new Intl.DateTimeFormat(getLocale(), {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);

/** When a session charged: its clock times, and past a day the day it began first. */
export function whenOf(s: Readonly<Session>, days: boolean, zone: string): string {
  const hours = m.detail_session_hours({
    from: clockOf(s.start, zone),
    to: clockOf(s.end, zone),
  });

  if (!days) return hours;

  return m.detail_session_day({
    day: shortDay(plantNow(zone, new Date(s.start)).day),
    hours,
  });
}

/** The plant's hourly rollups the PV share reads: house load, purchase and battery discharge. */
export interface PlantHours {
  readonly load: readonly Rolled[];
  readonly imported: readonly Rolled[];
  readonly discharge: readonly Rolled[];
}

/** Each rollup's energy in Wh by its start. */
const byStart = (rolled: readonly Rolled[]) => new Map(rolled.map((r) => [r.start, r.integral]));

/** The share of the hour's house load PV met directly, the battery's part not counted; null without load. */
function directOf(load: number | undefined, bought: number, gave: number): number | null {
  if (load === undefined || load < FLOOR_WH) return null;

  const own = Math.max(0, load - bought);

  return (own - Math.min(gave, own)) / load;
}

/** The share of `ev`'s hourly charge PV met directly, in %; null without a charge in a read hour. */
export function pvShareOf(ev: readonly Rolled[], plant: Readonly<PlantHours>): number | null {
  const [load, bought, gave] = [
    byStart(plant.load),
    byStart(plant.imported),
    byStart(plant.discharge),
  ];

  let [charged, pv] = [0, 0];

  for (const r of ev) {
    const direct = directOf(load.get(r.start), bought.get(r.start) ?? 0, gave.get(r.start) ?? 0);

    if (direct === null || r.integral < FLOOR_WH) continue;

    charged += r.integral;
    pv += r.integral * direct;
  }

  return charged === 0 ? null : (pv / charged) * 100;
}
