// What the plant's flows sum to over a span, from the `plant` device's powers (ADR 4, 14). The
// shares are the dashboard's (`dashboard/today.ts`), so a day here reads as it does there.
import { today, type Interval } from "../dashboard/today.ts";
import type { Span } from "../range/fill.ts";

/** The plant's power histories, each a role of the `plant` device (ADR 4). */
export interface Plant {
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

/** kWh each way over [from, to): while positive, and while negative as a positive number. */
function energy(
  intervals: readonly Interval[],
  from: number,
  to: number,
): readonly [number, number] {
  let [up, down] = [0, 0];

  eachPart(intervals, from, to, (a, b, mean) => {
    const kwh = (mean * (b - a)) / HOUR / 1000;

    if (kwh > 0) up += kwh;
    else down -= kwh;
  });

  return [up, down];
}

/** The plant's flows over [from, to). */
export function sumOf(plant: Plant, from: number, to: number): Sum {
  const kwh = (of: readonly Interval[]) => energy(of, from, to)[0];
  const [charge, discharge] = energy(plant.battery, from, to);

  const t = today(
    {
      "pv.power": kwh(plant.pv),
      "load.power": kwh(plant.load),
      "grid.import.power": kwh(plant.imported),
      "grid.export.power": kwh(plant.exported),
      "self.consumption.power": kwh(plant.selfUsed),
      "self.supply.power": kwh(plant.selfCovered),
    },
    { production: null, consumption: null },
  );

  return {
    production: t.production,
    consumption: t.consumption,
    feedIn: t.feedIn,
    purchase: t.purchase,
    selfUsed: kwh(plant.selfUsed),
    selfCovered: kwh(plant.selfCovered),
    charge,
    discharge,
    ev: kwh(plant.ev),
    autarky: t.autarky,
    selfUse: t.selfUse,
    covered: length(plant.load, from, to),
  };
}

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
