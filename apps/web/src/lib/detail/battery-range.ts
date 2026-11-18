// The battery sheet's range (ADR 21 "Sheet content"): the plant's state of charge laid on its
// bands, and what went in and out, from the plant's battery split (ADR 14).
import { PLANT } from "../api/core.ts";
import {
  bandFigure,
  periodOf,
  rollups,
  type Rolled,
  type RollupPeriod,
} from "../history/history.ts";
import { bandsOf } from "../range/fill.ts";
import { cyclesOf, roundTrip } from "./battery.ts";
import { strict } from "./measure.ts";
import type { RangeInput, RangeReader } from "./sheet-range.svelte.ts";

/** The plant's battery over the range: what charged it, what it gave, its charge and capacity. */
interface Read {
  readonly charge: readonly Rolled[];
  readonly discharge: readonly Rolled[];
  readonly soc: readonly Rolled[];
  readonly capacity: readonly Rolled[];
  /** The state of charge at the range's first and last read hour; null without one. */
  readonly ends: readonly [number, number] | null;
}

const NONE: Read = { charge: [], discharge: [], soc: [], capacity: [], ends: null };

const DAY = 86_400_000;

/** All of a series' rollups. */
const whole = (series: string, rolled: readonly Rolled[]) =>
  bandFigure(series, rolled, -Infinity, Infinity);

/** The mean of what was read over all of `rolled`; null without a reading. */
function meanOf(series: string, rolled: readonly Rolled[]): number | null {
  const f = whole(series, rolled);

  return f.covered > 0 ? f.value : null;
}

/** The first read state of charge of `head` and the last of `tail`, by the hour; null without. */
function endsOf(head: readonly Rolled[], tail: readonly Rolled[]): Read["ends"] {
  const [first, last] = [head.find((r) => r.covered > 0), tail.findLast((r) => r.covered > 0)];

  return first && last ? [first.mean, last.mean] : null;
}

type Reader = (series: string, period: RollupPeriod, from: Date, to: Date) => Promise<Rolled[]>;

/** The state of charge at the range's ends: a day's mean is no end, so its hours are read there. */
async function endsAt(
  read: Reader,
  soc: readonly Rolled[],
  period: RollupPeriod,
  a: Date,
  b: Date,
) {
  if (period === "hour") return endsOf(soc, soc);

  const [head, tail] = await Promise.all([
    read("battery.soc", "hour", a, new Date(Math.min(a.getTime() + DAY, b.getTime()))),
    read("battery.soc", "hour", new Date(Math.max(b.getTime() - DAY, a.getTime())), b),
  ]);

  return endsOf(head, tail);
}

/** The state of charge by band, the round-trip efficiency and the cycles; null unread. */
export const BATTERY_RANGE = {
  load: async (input, from, to, now) => {
    const { core, route } = input();
    const period = periodOf(route.range);
    const [a, b] = [from, new Date(Math.min(to.getTime(), now))];

    if (a.getTime() >= b.getTime()) return NONE;

    const sure = strict(core);
    const any: Reader = (series, p, x, y) => rollups(sure, PLANT, series, p, x, y);
    const read = (series: string) => any(series, period, a, b);

    const [charge, discharge, soc, capacity] = await Promise.all([
      read("battery.charge.power"),
      read("battery.discharge.power"),
      read("battery.soc"),
      read("battery.capacity"),
    ]);

    return { charge, discharge, soc, capacity, ends: await endsAt(any, soc, period, a, b) };
  },
  view: (got) => {
    if (got === null) return null;

    const { charge, discharge, soc } = got.data;

    const bands = bandsOf(got.list, (_, i) => {
      const [a, b] = got.spans[i]!;
      const f = bandFigure("battery.soc", soc, a, b);

      return {
        up: [f.value],
        down: [],
        covered: f.covered,
        elapsed: Math.max(0, Math.min(b, got.now) - a),
      };
    });

    const capacity = meanOf("battery.capacity", got.data.capacity);
    const charged = whole("battery.charge.power", charge).value;
    const discharged = whole("battery.discharge.power", discharge).value;

    return {
      bands,
      efficiency: roundTrip({ charged, discharged, soc: got.data.ends, capacity }),
      cycles: cyclesOf(discharged, capacity),
    };
  },
} satisfies RangeReader<RangeInput, Read, unknown>;
