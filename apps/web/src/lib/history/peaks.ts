// The range's peaks (ADR 3, 9): each flow's highest reading, from the `max` of the plant's hourly
// or daily rollups, with the hour or the day it fell in. Pure.
import { flowColour, type Flow } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import { plantNow } from "../plant-day.ts";
import { fmt } from "../range/calendar.ts";
import { rangeFor, type Range } from "../range/range.ts";
import type { Plant, PlantFlow } from "./flows.ts";
import type { Rolled } from "./history.ts";

export interface Peak {
  readonly label: string;
  /** In W. */
  readonly value: number;
  /** The hour of a day's peak, or its day. */
  readonly when: string;
  readonly colour: string;
  /** The day it opens; null within a day. */
  readonly range: Range | null;
}

export interface PeakInput {
  /** The range, in ms since the epoch. */
  readonly from: number;
  readonly to: number;
  /** The range's bands are hours: the peaks come from the hourly rollups. */
  readonly hours: boolean;
  readonly zone: string;
}

const FLOWS: readonly (readonly [PlantFlow, () => string, Flow])[] = [
  ["pv", m.stats_peak_pv, "solar"],
  ["load", m.stats_house, "house"],
  ["imported", m.stats_bought, "import"],
  ["exported", m.stats_feed_in, "export"],
];

/** The rollup with the highest reading among those starting in [from, to). */
function highest(rolled: readonly Rolled[], from: number, to: number): Rolled | null {
  let best: Rolled | null = null;

  for (const r of rolled)
    if (r.start >= from && r.start < to && (r.max ?? 0) > (best?.max ?? 0)) best = r;

  return best;
}

/** When a peak read from the rollup starting at `start` fell: its hour, or past a day its day. */
export function whenOf(start: number, hours: boolean, zone: string): string {
  const { day, hour } = plantNow(zone, new Date(start));

  return hours ? m.stats_peak_hour({ from: hour, to: hour + 1 }) : fmt("dayShort", day);
}

/** Each flow's peak over the range; a flow that never ran has none. */
export function peaksOf(plant: Plant, at: PeakInput): Peak[] {
  const rollups = at.hours ? plant.hours : plant.days;

  return FLOWS.flatMap(([flow, label, colour]) => {
    const top = highest(rollups[flow], at.from, at.to);

    if (top === null) return [];

    return [
      {
        label: label(),
        value: top.max ?? 0,
        when: whenOf(top.start, at.hours, at.zone),
        colour: flowColour(colour),
        range: at.hours ? null : rangeFor("day", plantNow(at.zone, new Date(top.start)).day),
      },
    ];
  });
}
