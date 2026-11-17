// What a measured sheet's head reads over a range (ADR 21): its figure, and where its readings
// stop. A refused read fails like a lost one: the sheet says so instead of showing an empty range.
import { PLANT, type Core, type PvString } from "../api/core.ts";
import { TARIFF } from "../api/computed-devices.ts";
import { analyticsOf } from "../analytics/sources.ts";
import { share } from "../dashboard/today.ts";
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
  /** A share, whose change is in percentage points. */
  readonly points?: boolean;
  /** The figure from `from` to before `to`, in ms, cut in `period`; rejects when the core fails. */
  readonly read: (from: number, to: number, period: RollupPeriod) => Promise<Measured>;
}

export type MeasureCore = Readonly<Pick<Core, "statistics">>;

/** The core with every refusal thrown. */
export const strict = (core: MeasureCore): MeasureCore => ({
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

/** How a series' rollups sum to a figure: its unit and digits, and what one unit integrates to. */
type Sum = Readonly<{ unit: string; digits: number; per: number }>;

/** A power series' energy in kWh. */
const KWH: Sum = { unit: "kWh", digits: 1, per: 1000 };

/** A rate in EUR/h integrates to EUR (ADR 12). */
const EUR: Sum = { unit: "€", digits: 2, per: 1 };

/** A series' integral over the span, in `sum`'s unit. */
function integral(core: MeasureCore, device: number, series: string, sum: Sum): Measure {
  const sure = strict(core);

  return {
    device,
    series,
    unit: sum.unit,
    digits: sum.digits,
    read: async (from, to, period) => {
      const rolled = await rollups(sure, device, series, period, new Date(from), new Date(to));
      const read = rolled.filter((r) => r.covered > 0);

      return {
        value: read.length === 0 ? null : read.reduce((a, r) => a + r.integral, 0) / sum.per,
        stops: stopOf(rolled, to),
      };
    },
  };
}

/** The energy of `rolled` in kWh. */
function kwh(rolled: readonly Rolled[]): number {
  return rolled.reduce((a, r) => a + r.integral, 0) / 1000;
}

/** The share of `whole`'s energy that `part` holds, in %: the house load met on site is autarky. */
function shareOf(core: MeasureCore, part: string, whole: string): Measure {
  const sure = strict(core);

  return {
    device: PLANT,
    // The record's edges and stops follow what the share is of.
    series: whole,
    unit: "%",
    digits: 0,
    points: true,
    read: async (from, to, period) => {
      const read = (series: string) =>
        rollups(sure, PLANT, series, period, new Date(from), new Date(to));

      const [of, all] = await Promise.all([read(part), read(whole)]);

      return { value: share(kwh(of), kwh(all)), stops: stopOf(all, to) };
    },
  };
}

/** What a sheet's figure reads through: its id, the core and the layout's strings. */
export interface MeasureInput {
  readonly id: string;
  readonly core: MeasureCore;
  readonly strings: readonly Readonly<PvString>[];
}

/** The head figure of sheet `id`: autarky, the euros saved, or its series' energy; null for a sheet without one. */
export function measureOf({ id, core, strings }: MeasureInput): Measure | null {
  if (id === "autarky") return shareOf(core, "self.supply.power", "load.power");

  if (id === "saved") return integral(core, TARIFF, "cost.savings.rate", EUR);

  const a = analyticsOf(id, strings);

  return a === null || a.energy === null ? null : integral(core, a.device, a.energy, KWH);
}
