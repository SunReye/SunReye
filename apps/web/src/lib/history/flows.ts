// What the plant's flows sum to over a span, from the `plant` device's day rollups (ADR 3, 4, 14):
// the dashboard's today reads the same rollups through the same shares (`dashboard/today.ts`).
import { today, type Interval } from "../dashboard/today.ts";
import type { Span } from "../range/fill.ts";

/** One plant-local day's energy of a power: Wh from `start`, ms since the epoch. */
export interface Rolled {
  readonly start: number;
  readonly wh: number;
}

/** The plant's power histories, each a role of the `plant` device (ADR 4). */
export interface Curves {
  /** `pv.power`. */
  readonly pv: readonly Interval[];
  /** `load.power`. */
  readonly load: readonly Interval[];
  /** `grid.import.power`. */
  readonly imported: readonly Interval[];
  /** `grid.export.power`. */
  readonly exported: readonly Interval[];
  /** `self.consumption.power`: the PV not fed in. */
  readonly selfUsed: readonly Interval[];
  /** `self.supply.power`: the house load not bought. */
  readonly selfCovered: readonly Interval[];
  /** `battery.power`, positive while charging. */
  readonly battery: readonly Interval[];
  /** `ev.charge.power`. */
  readonly ev: readonly Interval[];
}

/** The plant's day rollups as the core folds them (ADR 3), and its power histories. */
export interface Plant extends Curves {
  /** Today's is rolled up to its latest reading. */
  readonly days: Readonly<Record<keyof Curves, readonly Rolled[]>>;
}

const NONE = {
  pv: [],
  load: [],
  imported: [],
  exported: [],
  selfUsed: [],
  selfCovered: [],
  battery: [],
  ev: [],
} as const satisfies Curves;

/** A plant not read. */
export const NO_PLANT: Plant = { ...NONE, days: NONE };

/** kWh, autarky and self-use in %, `covered` in ms. */
export interface Sum {
  readonly production: number;
  readonly consumption: number;
  readonly feedIn: number;
  readonly purchase: number;
  /** Production not fed in. */
  readonly selfUsed: number;
  /** Consumption not bought. */
  readonly selfCovered: number;
  readonly charge: number;
  readonly discharge: number;
  readonly ev: number;
  readonly autarky: number | null;
  readonly selfUse: number | null;
  /** How long the house load was read. */
  readonly covered: number;
}

/** Intervals as instants, sorted by start, read once per history (a range sums hundreds of bands). */
interface Indexed {
  readonly start: readonly number[];
  readonly end: readonly number[];
  readonly mean: readonly number[];
  /** The longest interval: no interval starting before `from - longest` reaches `from`. */
  readonly longest: number;
}

const INDEXED = new WeakMap<readonly Interval[], Indexed>();

function indexed(intervals: readonly Interval[]): Indexed {
  const known = INDEXED.get(intervals);

  if (known) return known;

  const parsed = intervals
    .map((i) => [Date.parse(i.start), Date.parse(i.end), i.mean] as const)
    .toSorted((a, b) => a[0] - b[0]);

  const index: Indexed = {
    start: parsed.map((p) => p[0]),
    end: parsed.map((p) => p[1]),
    mean: parsed.map((p) => p[2]),
    longest: parsed.reduce((a, p) => Math.max(a, p[1] - p[0]), 0),
  };

  INDEXED.set(intervals, index);

  return index;
}

/** The first interval that may reach into [from, …). */
function firstFrom(index: Indexed, from: number): number {
  const at = from - index.longest;
  let [lo, hi] = [0, index.start.length];

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (index.start[mid]! < at) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

/**
 * Calls `part` with each interval's part inside [from, to) as its start, end and mean; a mean
 * holds over its interval, so a part keeps it.
 */
function eachPart(
  intervals: readonly Interval[],
  from: number,
  to: number,
  part: (a: number, b: number, mean: number) => void,
): void {
  const index = indexed(intervals);

  for (let i = firstFrom(index, from); i < index.start.length && index.start[i]! < to; i++) {
    const [a, b] = [Math.max(from, index.start[i]!), Math.min(to, index.end[i]!)];

    if (b > a) part(a, b, index.mean[i]!);
  }
}

/** How long the intervals cover of [from, to), in ms. */
function length(intervals: readonly Interval[], from: number, to: number): number {
  let sum = 0;

  eachPart(intervals, from, to, (a, b) => {
    sum += b - a;
  });

  return sum;
}

const HOUR = 3_600_000;

/** The figures from each way's kWh, and how long the house load was read. */
function sum(
  kwh: (of: keyof Curves) => number,
  battery: readonly [number, number],
  covered: number,
): Sum {
  const t = today(
    {
      "pv.power": kwh("pv"),
      "load.power": kwh("load"),
      "grid.import.power": kwh("imported"),
      "grid.export.power": kwh("exported"),
      "self.consumption.power": kwh("selfUsed"),
      "self.supply.power": kwh("selfCovered"),
    },
    { production: null, consumption: null },
  );

  return {
    production: t.production,
    consumption: t.consumption,
    feedIn: t.feedIn,
    purchase: t.purchase,
    selfUsed: kwh("selfUsed"),
    selfCovered: kwh("selfCovered"),
    charge: battery[0],
    discharge: battery[1],
    ev: kwh("ev"),
    autarky: t.autarky,
    selfUse: t.selfUse,
    covered,
  };
}

/** kWh each way: positive figures, and negative ones as a positive number. */
function split(figures: readonly number[]): readonly [number, number] {
  let [up, down] = [0, 0];

  for (const kwh of figures)
    if (kwh > 0) up += kwh;
    else down -= kwh;

  return [up, down];
}

/** The plant's flows over the days starting in [from, to). */
export function sumOf(plant: Plant, from: number, to: number): Sum {
  const days = (of: keyof Curves) =>
    plant.days[of].filter((d) => d.start >= from && d.start < to).map((d) => d.wh / 1000);

  return sum((of) => split(days(of))[0], split(days("battery")), length(plant.load, from, to));
}

/**
 * The plant's flows over a band shorter than a day, from its power histories: the core publishes
 * no rollup finer than a day (ADR 9).
 */
export function hourSum(plant: Plant, from: number, to: number): Sum {
  const parts = (of: keyof Curves) => {
    const out: number[] = [];

    eachPart(plant[of], from, to, (a, b, mean) => {
      out.push((mean * (b - a)) / HOUR / 1000);
    });

    return out;
  };

  return sum((of) => split(parts(of))[0], split(parts("battery")), length(plant.load, from, to));
}

/** A band of `hours` over [from, to): by its day rollups, or by its histories under a day. */
export const bandSum = (plant: Plant, hours: number, from: number, to: number): Sum =>
  (hours < 24 ? hourSum : sumOf)(plant, from, to);

/** Holes of an hour or more in the house load's record over [from, min(to, now)). */
export function gapsOf(plant: Plant, from: number, to: number, now: number): Span[] {
  const end = Math.min(to, now);

  const parts: (readonly [number, number])[] = [];

  eachPart(plant.load, from, end, (a, b) => {
    parts.push([a, b]);
  });

  const out: Span[] = [];
  let at = from;

  for (const [a, b] of [...parts, [end, end] as const]) {
    if (a - at >= HOUR) out.push({ start: at, end: a });

    at = Math.max(at, b);
  }

  return out;
}
