// What the consumption, house, feed-in, purchase and generator sheets say of their range (ADR 21
// "Sheet content"): the peak with its time, for the house the share PV covered directly, and for
// feed-in and purchase their euros. Pure.
import { rollupSum, type Rollups } from "../history/flows.ts";
import { highest, whenOf } from "../history/peaks.ts";
import type { Rolled } from "../history/history.ts";
import { m } from "../paraglide/messages.js";
import { coverOf } from "./autarky.ts";
import type { Fact } from "./figures.ts";

/** A flow sheet: the `plant` power it peaks in, and the tariff's rate that prices it (ADR 12). */
export interface Flow {
  readonly series: string;
  /** The house load: what share PV covered directly, as the autarky sheet's bar reads it. */
  readonly cover: boolean;
  readonly money: { readonly series: string; readonly label: () => string } | null;
}

const PAID = { series: "cost.import.rate", label: m.detail_paid };
const EARNED = { series: "cost.export.rate", label: m.detail_earned };

const FLOWS = new Map<string, Flow>([
  ["consumption", { series: "load.power", cover: true, money: null }],
  ["house", { series: "load.power", cover: true, money: null }],
  ["feedIn", { series: "grid.export.power", cover: false, money: EARNED }],
  ["purchase", { series: "grid.import.power", cover: false, money: PAID }],
  ["generator", { series: "generator.power", cover: false, money: null }],
]);

/** The flow sheet `id` is; null for any other. */
export const flowOf = (id: string): Flow | null => FLOWS.get(id) ?? null;

/** What a flow sheet read of its range. */
export interface FlowRead {
  /** The flow's rollups. */
  readonly peak: readonly Rolled[];
  /** The plant's flows, for the share PV covered; null unread. */
  readonly flows: Rollups | null;
  /** The rate's rollups; null unread. */
  readonly money: readonly Rolled[] | null;
  /** The rollups are hours, so the peak names its hour; else its day. */
  readonly hours: boolean;
  readonly zone: string;
}

/** Euros to the cent below 100, whole above, as the range's money reads. */
const euros = (label: string, value: number | null): Fact => ({
  label,
  value,
  unit: "€",
  digits: value !== null && Math.abs(value) >= 100 ? 0 : 2,
});

function peakOf(read: Readonly<FlowRead> | null): Fact {
  const top = read === null ? null : highest(read.peak, -Infinity, Infinity);
  const fact: Fact = { label: m.detail_peak(), value: top?.max ?? null, unit: "W", digits: 0 };

  return top === null || read === null
    ? fact
    : { ...fact, note: whenOf(top.start, read.hours, read.zone) };
}

/** The euros of the rollups read; null without any. */
function sumOf(rolled: readonly Rolled[] | null): number | null {
  const read = rolled?.filter((r) => r.covered > 0) ?? [];

  return read.length === 0 ? null : read.reduce((a, r) => a + r.integral, 0);
}

/** The share of the house load PV covered directly, in %; null without load. */
function coveredOf(flows: Rollups | null): Fact {
  const share =
    flows === null ? null : (coverOf(rollupSum(flows, -Infinity, Infinity))?.[0] ?? null);

  return { label: m.detail_pv_covered(), value: share, unit: "%", digits: 0 };
}

/** The facts row: the peak with its time, then the share PV covered or the flow's euros. */
export function flowFacts(flow: Readonly<Flow>, read: Readonly<FlowRead> | null): Fact[] {
  const cover = flow.cover ? [coveredOf(read?.flows ?? null)] : [];
  const money = flow.money === null ? [] : [euros(flow.money.label(), sumOf(read?.money ?? null))];

  return [peakOf(read), ...cover, ...money];
}
