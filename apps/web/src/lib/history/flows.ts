// What the plant's flows sum to over a span, from the `plant` device's powers (ADR 4, 14). The
// arithmetic is the dashboard's (`dashboard/today.ts`), so a day here reads as it does there.
import { energy, today, type Interval } from "../dashboard/today.ts";
import type { Span } from "../range/fill.ts";

/** The plant's power histories: `pv`, `load`, `grid`, `battery` and `ev.charge` power. */
export interface Plant {
  readonly pv: readonly Interval[];
  readonly load: readonly Interval[];
  readonly grid: readonly Interval[];
  readonly battery: readonly Interval[];
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

/** The intervals' parts inside [from, to); a mean holds over its interval, so a part keeps it. */
function clip(intervals: readonly Interval[], from: number, to: number): Interval[] {
  const out: Interval[] = [];

  for (const i of intervals) {
    const [a, b] = [Math.max(from, Date.parse(i.start)), Math.min(to, Date.parse(i.end))];

    if (b > a)
      out.push({ start: new Date(a).toISOString(), end: new Date(b).toISOString(), mean: i.mean });
  }

  return out;
}

const length = (intervals: readonly Interval[]) =>
  intervals.reduce((a, i) => a + Date.parse(i.end) - Date.parse(i.start), 0);

/** The plant's flows over [from, to). */
export function sumOf(plant: Plant, from: number, to: number): Sum {
  const flowed = (of: readonly Interval[]) => energy(clip(of, from, to));
  const [pv, load, grid, battery, ev] = [plant.pv, plant.load, plant.grid, plant.battery, plant.ev];
  const t = today({ pv: flowed(pv), load: flowed(load), grid: flowed(grid) });
  const stored = flowed(battery);

  return {
    production: t.production,
    consumption: t.consumption,
    feedIn: t.feedIn,
    purchase: t.purchase,
    selfUsed: Math.max(0, t.production - t.feedIn),
    selfCovered: Math.max(0, t.consumption - t.purchase),
    charge: stored.positive,
    discharge: stored.negative,
    ev: flowed(ev).positive,
    autarky: t.autarky,
    selfUse: t.selfUse,
    covered: length(clip(load, from, to)),
  };
}

const HOUR = 3_600_000;

/** Holes of an hour or more in the house load's record over [from, min(to, now)). */
export function gapsOf(plant: Plant, from: number, to: number, now: number): Span[] {
  const end = Math.min(to, now);

  const parts = clip(plant.load, from, end)
    .map((i) => [Date.parse(i.start), Date.parse(i.end)] as const)
    .toSorted((a, b) => a[0] - b[0]);

  const out: Span[] = [];
  let at = from;

  for (const [a, b] of [...parts, [end, end] as const]) {
    if (a - at >= HOUR) out.push({ start: at, end: a });

    at = Math.max(at, b);
  }

  return out;
}
