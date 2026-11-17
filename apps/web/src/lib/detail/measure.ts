// What a measured sheet's head reads over a range (ADR 21): its figure, and where its readings
// stop. A refused read fails like a lost one: the sheet says so instead of showing an empty range.
import type { Core, PvString } from "../api/core.ts";
import { analyticsOf } from "../analytics/sources.ts";
import { rollups, type Rolled, type RollupPeriod } from "../history/history.ts";

export interface Measured {
  /** Null where nothing was read. */
  readonly value: number | null;
  /** Where readings stop short of the end read, in ms since the epoch; null where they reach it. */
  readonly stops: number | null;
}

/** A sheet's head figure: the stored series it rests on, and how it reads a span. */
export interface Measure {
  /** The stored series whose first reading begins the record (ADR 22). */
  readonly device: number;
  readonly series: string;
  readonly unit: string;
  readonly digits: number;
  /** The figure from `from` to before `to`, in ms, cut in `period`; rejects when the core fails. */
  readonly read: (from: number, to: number, period: RollupPeriod) => Promise<Measured>;
}

export type MeasureCore = Readonly<Pick<Core, "statistics">>;

/** The core with every refusal thrown. */
const strict = (core: MeasureCore): MeasureCore => ({
  statistics: async (...args: Readonly<Parameters<MeasureCore["statistics"]>>) => {
    const read = await core.statistics(...args);

    if ("problem" in read) throw new Error(read.problem);

    return read;
  },
});

/** Readings that end this far before the end read have not stopped: the open hour lags its flush. */
export const LAG_MS = 15 * 60_000;

/** Where readings stop short of `end`: inside the last rollup read, when later ones read nothing. */
function stopOf(rolled: readonly Rolled[], end: number): number | null {
  const last = rolled.findLast((r) => r.covered > 0);

  if (last === undefined || last.end >= end - LAG_MS) return null;

  return Math.min(last.end, last.start + last.covered);
}

/** A power series' energy in kWh. */
function energy(core: MeasureCore, device: number, series: string): Measure {
  const sure = strict(core);

  return {
    device,
    series,
    unit: "kWh",
    digits: 1,
    read: async (from, to, period) => {
      const rolled = await rollups(sure, device, series, period, new Date(from), new Date(to));
      const read = rolled.filter((r) => r.covered > 0);

      return {
        value: read.length === 0 ? null : read.reduce((a, r) => a + r.integral, 0) / 1000,
        stops: stopOf(rolled, to),
      };
    },
  };
}

/** What a sheet's figure reads through: its id, the core and the layout's strings. */
export interface MeasureInput {
  readonly id: string;
  readonly core: MeasureCore;
  readonly strings: readonly Readonly<PvString>[];
}

/** The head figure of sheet `id`: its series' energy; null for a sheet without one. */
export function measureOf({ id, core, strings }: MeasureInput): Measure | null {
  const a = analyticsOf(id, strings);

  return a === null || a.energy === null ? null : energy(core, a.device, a.energy);
}
