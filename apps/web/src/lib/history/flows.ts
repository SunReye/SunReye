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

const HOUR = 3_600_000;

/** kWh each way over the intervals: while positive, and while negative as a positive number. */
function energy(intervals: readonly Interval[]): readonly [number, number] {
  let [up, down] = [0, 0];

  for (const { start, end, mean } of intervals) {
    const kwh = (mean * (Date.parse(end) - Date.parse(start))) / HOUR / 1000;

    if (kwh > 0) up += kwh;
    else down -= kwh;
  }

  return [up, down];
}

/** The plant's flows over [from, to). */
export function sumOf(plant: Plant, from: number, to: number): Sum {
  const kwh = (of: readonly Interval[]) => energy(clip(of, from, to))[0];
  const [charge, discharge] = energy(clip(plant.battery, from, to));

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
    covered: length(clip(plant.load, from, to)),
  };
}

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
