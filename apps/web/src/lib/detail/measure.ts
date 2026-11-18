// What a measured sheet's head reads over a range (ADR 21): its figure, and where its readings
// stop. A refused read fails like a lost one: the sheet says so instead of showing an empty range.
import { PLANT, type Core } from "../api/core.ts";
import { share } from "../dashboard/today.ts";
import { euroDigits } from "../range/format.ts";
import { coveredSum, rollups, type Rolled, type RollupPeriod } from "../history/history.ts";

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
  /** The digits a value is written with. */
  readonly digits: (value: number) => number;
  /** A share, whose change is in percentage points. */
  readonly points?: boolean;
  /** What it is, where the sheet's title does not say it: a battery's "Entladen". */
  readonly name?: string;
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
type Sum = Readonly<{ unit: string; digits: (value: number) => number; per: number }>;

/** A power series' energy in kWh. */
const KWH: Sum = { unit: "kWh", digits: () => 1, per: 1000 };

/** A rate in EUR/h integrates to EUR (ADR 12). */
const EUR: Sum = { unit: "€", digits: euroDigits, per: 1 };

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
      const total = coveredSum(rolled);

      return {
        value: total === null ? null : total / sum.per,
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
    digits: () => 0,
    points: true,
    read: async (from, to, period) => {
      const read = (series: string) =>
        rollups(sure, PLANT, series, period, new Date(from), new Date(to));

      const [of, all] = await Promise.all([read(part), read(whole)]);

      return { value: share(kwh(of), kwh(all)), stops: stopOf(all, to) };
    },
  };
}

/** What a sheet's head figure is over its range: a series' energy or euros, or a share of the house load. */
export type Head =
  | {
      readonly kind: "energy" | "money";
      readonly device: number;
      readonly series: string;
      /** What it is, where the sheet's title does not say it. */
      readonly name?: () => string;
    }
  | { readonly kind: "share"; readonly part: string; readonly whole: string };

/** The house load met on site: autarky. */
export const AUTARKY: Head = { kind: "share", part: "self.supply.power", whole: "load.power" };

/** How head `head` reads through `core`. */
export function measureOf(head: Readonly<Head>, core: MeasureCore): Measure {
  if (head.kind === "share") return shareOf(core, head.part, head.whole);

  const measure = integral(core, head.device, head.series, head.kind === "money" ? EUR : KWH);

  return head.name === undefined ? measure : { ...measure, name: head.name() };
}
