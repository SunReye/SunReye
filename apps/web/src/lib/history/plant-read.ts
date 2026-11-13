// The plant's rollups and its house load's history over a range (ADR 3, 9); the core caps each
// read, so a long range is read in pieces.
import type { Core } from "../api/core.ts";
import type { Interval } from "../dashboard/today.ts";
import { PLANT } from "../dashboard/day.ts";
import { FLOWS, NO_PLANT, type Flow, type Plant, type Rollups } from "./flows.ts";
import { rollups, type RollupPeriod } from "./history.ts";

const DAY = 86_400_000;
const PIECE = 1400 * DAY;

export type PlantCore = Readonly<Pick<Core, "history" | "statistics">>;

/** The house load's history, for the holes in its record. */
async function loadHistory(core: PlantCore, from: number, to: number) {
  const out: Interval[] = [];
  const pieces: (readonly [number, number])[] = [];

  for (let a = from; a < to; a += PIECE) pieces.push([a, Math.min(to, a + PIECE)]);

  const reads = await Promise.all(
    pieces.map((p) => core.history(PLANT, FLOWS.load, new Date(p[0]), new Date(p[1]))),
  );

  for (const read of reads) if ("points" in read) out.push(...read.points);

  return out;
}

/** Every flow's rollups of `period`. */
async function each(
  core: PlantCore,
  period: RollupPeriod,
  from: number,
  to: number,
): Promise<Rollups> {
  const read = (f: Flow) => rollups(core, PLANT, FLOWS[f], period, new Date(from), new Date(to));

  const [pv, load, imported, exported, selfUsed, selfCovered, charge, discharge, ev] =
    await Promise.all([
      read("pv"),
      read("load"),
      read("imported"),
      read("exported"),
      read("selfUsed"),
      read("selfCovered"),
      read("charge"),
      read("discharge"),
      read("ev"),
    ]);

  return { pv, load, imported, exported, selfUsed, selfCovered, charge, discharge, ev };
}

/**
 * The plant's day rollups from `from` to before `to`, ms since the epoch, with the house load's
 * history; `hours` also reads the hourly rollups, for bands shorter than a day. A missing series
 * is empty.
 */
export async function readPlant(
  core: PlantCore,
  from: number,
  to: number,
  hours = false,
): Promise<Plant> {
  const [days, hourly, load] = await Promise.all([
    each(core, "day", from, to),
    hours ? each(core, "hour", from, to) : NO_PLANT.hours,
    loadHistory(core, from, to),
  ]);

  return { days, hours: hourly, load };
}
