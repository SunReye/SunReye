// The battery sheet's range (ADR 21 "Sheet content"): the plant's state of charge laid on its
// bands, and what went in and out, from the plant's battery split (ADR 14).
import { bandFigure, periodOf, rollups, type Rolled } from "../history/history.ts";
import { bandsOf } from "../range/fill.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { PLANT } from "../api/core.ts";
import { cyclesOf, roundTrip } from "./battery.ts";
import { strict, type MeasureCore } from "./measure.ts";

/** What the range reads through, and where it stands. */
export interface BatteryInput {
  readonly core: MeasureCore;
  readonly route: RangeRoute;
}

/** The plant's battery over the range: what charged it, what it gave, its charge and capacity. */
interface Read {
  readonly charge: readonly Rolled[];
  readonly discharge: readonly Rolled[];
  readonly soc: readonly Rolled[];
  readonly capacity: readonly Rolled[];
}

const NONE: Read = { charge: [], discharge: [], soc: [], capacity: [] };

/** All of a series' rollups. */
const whole = (series: string, rolled: readonly Rolled[]) =>
  bandFigure(series, rolled, -Infinity, Infinity);

/** The mean of what was read over all of `rolled`; null without a reading. */
function meanOf(series: string, rolled: readonly Rolled[]): number | null {
  const f = whole(series, rolled);

  return f.covered > 0 ? f.value : null;
}

/** The first and the last read state of charge; null without one. */
function endsOf(soc: readonly Rolled[]): readonly [number, number] | null {
  const read = soc.filter((r) => r.covered > 0);
  const [first, last] = [read[0], read.at(-1)];

  return first && last ? [first.mean, last.mean] : null;
}

export class BatteryRange {
  readonly #data: RangeData<Read>;

  constructor(input: () => BatteryInput) {
    this.#data = new RangeData(
      () => input().route,
      async (from, to, now) => {
        const { core, route } = input();
        const period = periodOf(route.range);
        const [a, b] = [from, new Date(Math.min(to.getTime(), now))];

        if (a.getTime() >= b.getTime()) return NONE;

        const sure = strict(core);
        const read = (series: string) => rollups(sure, PLANT, series, period, a, b);

        const [charge, discharge, soc, capacity] = await Promise.all([
          read("battery.charge.power"),
          read("battery.discharge.power"),
          read("battery.soc"),
          read("battery.capacity"),
        ]);

        return { charge, discharge, soc, capacity };
      },
    );
  }

  get failed(): boolean {
    return this.#data.failed;
  }

  retry = (): void => {
    this.#data.retry();
  };

  /** The state of charge by band, the round-trip efficiency and the cycles; null unread. */
  readonly view = $derived.by(() => {
    const got = this.#data.current;

    if (got === undefined) return null;

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
      efficiency: roundTrip({ charged, discharged, soc: endsOf(soc), capacity }),
      cycles: cyclesOf(discharged, capacity),
    };
  });
}
