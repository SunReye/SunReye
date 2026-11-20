// The plant's rollups and its house load's history over a range (ADR 3, 9); the core caps each
// read, so a long range is read in pieces.
import { only, PLANT, type Core } from "../api/core.ts";
import type { Interval } from "../dashboard/today.ts";
import { PLANT_FLOWS, NO_PLANT, type PlantFlow, type Plant, type Rollups } from "./flows.ts";
import { rollupsOf, type RollupPeriod } from "./history.ts";

const DAY = 86_400_000;
const PIECE = 1400 * DAY;

export type PlantCore = Readonly<Pick<Core, "history" | "statistics">>;

/** The house load's history, for the holes in its record. */
async function loadHistory(core: PlantCore, from: number, to: number) {
  const out: Interval[] = [];
  const pieces: (readonly [number, number])[] = [];

  for (let a = from; a < to; a += PIECE) pieces.push([a, Math.min(to, a + PIECE)]);

  const reads = await Promise.all(
    pieces.map(async (p) =>
      only(await core.history(PLANT, [PLANT_FLOWS.load], new Date(p[0]), new Date(p[1]))),
    ),
  );

  for (const read of reads) if ("points" in read) out.push(...read.points);

  return out;
}

/** Every flow's rollups of `period`, read together. */
export async function readFlows(
  core: Readonly<Pick<Core, "statistics">>,
  period: RollupPeriod,
  from: number,
  to: number,
): Promise<Rollups> {
  const series = Object.values(PLANT_FLOWS);
  const read = await rollupsOf(core, PLANT, series, period, new Date(from), new Date(to));
  const of = (f: PlantFlow) => read[series.indexOf(PLANT_FLOWS[f])] ?? [];

  return {
    pv: of("pv"),
    load: of("load"),
    imported: of("imported"),
    exported: of("exported"),
    selfUsed: of("selfUsed"),
    selfCovered: of("selfCovered"),
    charge: of("charge"),
    discharge: of("discharge"),
    ev: of("ev"),
  };
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
    readFlows(core, "day", from, to),
    hours ? readFlows(core, "hour", from, to) : NO_PLANT.hours,
    loadHistory(core, from, to),
  ]);

  return { days, hours: hourly, load };
}
