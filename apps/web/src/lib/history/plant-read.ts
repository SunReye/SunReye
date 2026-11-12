// The plant's power histories over a range (ADR 9): the core picks the tier, at most 1,498 days a
// read, so a long range is read in pieces. A range up to a day reads as the dashboard's today.
import type { Core } from "../api/core.ts";
import type { Interval } from "../dashboard/today.ts";
import { PLANT } from "../dashboard/day.ts";
import type { Plant } from "./flows.ts";

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
} as const satisfies Record<keyof Plant, string>;

function pieces(from: number, to: number): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];

  for (let a = from; a < to; a += PIECE) out.push([a, Math.min(to, a + PIECE)]);

  return out;
}

async function series(
  core: Readonly<Pick<Core, "history">>,
  name: string,
  from: number,
  to: number,
): Promise<Interval[]> {
  const out: Interval[] = [];

  const reads = await Promise.all(
    pieces(from, to).map((piece) =>
      core.history(PLANT, name, new Date(piece[0]), new Date(piece[1])),
    ),
  );

  for (const read of reads) if ("points" in read) out.push(...read.points);

  return out;
}

/** The plant's powers from `from` to before `to`, ms since the epoch; a missing one is empty. */
export async function readPlant(
  core: Readonly<Pick<Core, "history">>,
  from: number,
  to: number,
): Promise<Plant> {
  const one = (name: string) => series(core, name, from, to);

  const [pv, load, imported, exported, selfUsed, selfCovered, battery, ev] = await Promise.all([
    one(SERIES.pv),
    one(SERIES.load),
    one(SERIES.imported),
    one(SERIES.exported),
    one(SERIES.selfUsed),
    one(SERIES.selfCovered),
    one(SERIES.battery),
    one(SERIES.ev),
  ]);

  return { pv, load, imported, exported, selfUsed, selfCovered, battery, ev };
}
