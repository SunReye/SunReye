// What the consumption, house, feed-in, purchase and generator sheets say of their range (ADR 21
// "Sheet content"): the peak with its time, for the house the share PV covered directly, and for
// feed-in and purchase their euros. Pure.
import { rollupSum, type Rollups } from "../history/flows.ts";
import { peakIn } from "../history/peaks.ts";
import type { Rolled } from "../history/history.ts";
import { m } from "../paraglide/messages.js";
import { coverOf } from "./autarky.ts";
import { peakFact } from "./facts.ts";
import type { Fact } from "./figures.ts";

/** A flow sheet: the `plant` power it peaks in, and the tariff's rate that prices it (ADR 12). */
export interface SheetFlow {
  readonly series: string;
  /** The house load: what share PV covered directly, as the autarky sheet's bar reads it. */
  readonly cover: boolean;
  /** The import price is charted by band. */
  readonly price: boolean;
  readonly money: { readonly series: string; readonly label: () => string } | null;
}

export const PAID = { series: "cost.import.rate", label: m.detail_paid };
export const EARNED = { series: "cost.export.rate", label: m.detail_earned };

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

/** The flow's peak with its time; unknown while the range is read. */
const peakOf = (read: Readonly<FlowRead> | null): Fact =>
  read === null
    ? { label: m.detail_peak(), value: null, unit: "W", digits: 0 }
    : peakFact(m.detail_peak(), peakIn(read.peak), "W", read);

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

/** What the flow was paid or earned; without a tariff in force, that none is (ADR 12). */
function moneyOf(
  money: SheetFlow["money"],
  read: Readonly<FlowRead> | null,
  priced: boolean,
): Fact[] {
  if (money === null) return [];

  if (!priced) return [{ label: money.label(), text: m.detail_no_tariff_short() }];

  return [euros(money.label(), sumOf(read?.money ?? null))];
}

/**
 * The facts row: the peak with its time, then the share PV covered or the flow's euros.
 * @param priced a tariff is in force
 */
export function flowFacts(
  flow: Readonly<SheetFlow>,
  read: Readonly<FlowRead> | null,
  priced: boolean,
): Fact[] {
  const cover = flow.cover ? [coveredOf(read?.flows ?? null)] : [];

  return [peakOf(read), ...cover, ...moneyOf(flow.money, read, priced)];
}
