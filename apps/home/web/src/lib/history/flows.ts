// What the plant's flows sum to over a span, from the `plant` device's hourly and day rollups
// (ADR 3, 4, 14): the dashboard's today reads the same rollups through the same shares
// (`dashboard/today.ts`). Nothing here integrates a power.
import { today, type Interval } from "../dashboard/today.ts";
import type { Span } from "../range/fill.ts";
import type { Rolled } from "./history.ts";

/** The plant's flows, each a power role of the `plant` device (ADR 4). */
export const PLANT_FLOWS = {
  pv: "pv.power",
  load: "load.power",
  imported: "grid.import.power",
  exported: "grid.export.power",
  /** The PV not fed in. */
  selfUsed: "self.consumption.power",
  /** The house load not bought. */
  selfCovered: "self.supply.power",
  charge: "battery.charge.power",
  discharge: "battery.discharge.power",
  ev: "ev.charge.power",
} as const;

export type PlantFlow = keyof typeof PLANT_FLOWS;

export type Rollups = Readonly<Record<PlantFlow, readonly Rolled[]>>;

/** The plant's rollups as the core reads them (ADR 3), and its house load's history. */
export interface Plant {
  /** Today's is rolled up to its latest reading. */
  readonly days: Rollups;
  /** Read only for bands of hours; this hour's is rolled up to its latest reading. */
  readonly hours: Rollups;
  /** `load.power`: where the record has holes. */
  readonly load: readonly Interval[];
}

const NONE: Rollups = {
  pv: [],
  load: [],
  imported: [],
  exported: [],
  selfUsed: [],
  selfCovered: [],
  charge: [],
  discharge: [],
  ev: [],
};

/** A plant not read. */
export const NO_PLANT: Plant = { days: NONE, hours: NONE, load: [] };

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

const HOUR = 3_600_000;

/** The flows over the rollups starting in [from, to), and how long the house load was read. */
export function rollupSum(rollups: Rollups, from: number, to: number): Sum {
  const inside = (of: PlantFlow) => rollups[of].filter((r) => r.start >= from && r.start < to);
  const kwh = (of: PlantFlow) => inside(of).reduce((a, r) => a + r.integral, 0) / 1000;

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
    charge: kwh("charge"),
    discharge: kwh("discharge"),
    ev: kwh("ev"),
    autarky: t.autarky,
    selfUse: t.selfUse,
    covered: inside("load").reduce((a, r) => a + r.covered, 0),
  };
}

/** The plant's flows over the days starting in [from, to). */
export const sumOf = (plant: Plant, from: number, to: number): Sum =>
  rollupSum(plant.days, from, to);

/** The plant's flows over the hours starting in [from, to). */
export const hourSum = (plant: Plant, from: number, to: number): Sum =>
  rollupSum(plant.hours, from, to);

/** A band of `hours` over [from, to): by its day rollups, or by its hourly ones under a day. */
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
