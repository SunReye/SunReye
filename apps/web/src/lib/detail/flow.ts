// What the consumption, house, feed-in, purchase and generator sheets say of their range (ADR 21
// "Sheet content"): the peak with its time, and for feed-in and purchase their euros. Pure.
import { highest, whenOf } from "../history/peaks.ts";
import type { Rolled } from "../history/history.ts";
import { m } from "../paraglide/messages.js";
import type { Fact } from "./figures.ts";

/** A flow sheet: the `plant` power it peaks in, and the tariff's rate that prices it (ADR 12). */
export interface Flow {
  readonly series: string;
  readonly money: { readonly series: string; readonly label: () => string } | null;
}

const PAID = { series: "cost.import.rate", label: m.detail_paid };
const EARNED = { series: "cost.export.rate", label: m.detail_earned };

const FLOWS = new Map<string, Flow>([
  ["consumption", { series: "load.power", money: null }],
  ["house", { series: "load.power", money: null }],
  ["feedIn", { series: "grid.export.power", money: EARNED }],
  ["purchase", { series: "grid.import.power", money: PAID }],
  ["generator", { series: "generator.power", money: null }],
]);

/** The flow sheet `id` is; null for any other. */
export const flowOf = (id: string): Flow | null => FLOWS.get(id) ?? null;

/** What a flow sheet read of its range. */
export interface FlowRead {
  /** The flow's rollups. */
  readonly peak: readonly Rolled[];
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

/** The facts row: the peak with its time, then what the flow was paid or earned. */
export function flowFacts(flow: Readonly<Flow>, read: Readonly<FlowRead> | null): Fact[] {
  const money = flow.money === null ? [] : [euros(flow.money.label(), sumOf(read?.money ?? null))];

  return [peakOf(read), ...money];
}
