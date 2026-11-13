// The plant's day rollups and power histories over a range (ADR 3, 9): the core caps a read at
// 1,498 days, so a long range is read in pieces.
import type { Core } from "../api/core.ts";
import type { Interval } from "../dashboard/today.ts";
import { PLANT } from "../dashboard/day.ts";
import type { Curves, Plant, Rolled } from "./flows.ts";

const DAY = 86_400_000;
const PIECE = 1400 * DAY;

const SERIES = {
  pv: "pv.power",
  load: "load.power",
  imported: "grid.import.power",
  exported: "grid.export.power",
  selfUsed: "self.consumption.power",
  selfCovered: "self.supply.power",
  battery: "battery.power",
  ev: "ev.charge.power",
} as const satisfies Record<keyof Curves, string>;

export type PlantCore = Readonly<Pick<Core, "history" | "statistics">>;

function pieces(from: number, to: number): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];

  for (let a = from; a < to; a += PIECE) out.push([a, Math.min(to, a + PIECE)]);

  return out;
}

async function history(core: PlantCore, name: string, from: number, to: number) {
  const out: Interval[] = [];

  const reads = await Promise.all(
    pieces(from, to).map((piece) =>
      core.history(PLANT, name, new Date(piece[0]), new Date(piece[1])),
    ),
  );

  for (const read of reads) if ("points" in read) out.push(...read.points);

  return out;
}

async function rollups(core: PlantCore, name: string, from: number, to: number) {
  const out: Rolled[] = [];

  const reads = await Promise.all(
    pieces(from, to).map((piece) =>
      core.statistics(PLANT, name, "day", new Date(piece[0]), new Date(piece[1])),
    ),
  );

  for (const read of reads)
    if ("points" in read)
      for (const p of read.points) out.push({ start: Date.parse(p.start), wh: p.integral ?? 0 });

  return out;
}

async function each<T>(read: (key: keyof Curves) => Promise<T>): Promise<Record<keyof Curves, T>> {
  const [pv, load, imported, exported, selfUsed, selfCovered, battery, ev] = await Promise.all([
    read("pv"),
    read("load"),
    read("imported"),
    read("exported"),
    read("selfUsed"),
    read("selfCovered"),
    read("battery"),
    read("ev"),
  ]);

  return { pv, load, imported, exported, selfUsed, selfCovered, battery, ev };
}

/**
 * The plant's day rollups from `from` to before `to`, ms since the epoch, with the house load's
 * history; `hours` also reads every power's history, for bands shorter than a day. A missing
 * series is empty.
 */
export async function readPlant(
  core: PlantCore,
  from: number,
  to: number,
  hours = false,
): Promise<Plant> {
  const [days, curves] = await Promise.all([
    each((key) => rollups(core, SERIES[key], from, to)),
    each((key) =>
      hours || key === "load" ? history(core, SERIES[key], from, to) : Promise.resolve([]),
    ),
  ]);

  return { ...curves, days };
}
