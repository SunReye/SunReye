// What the battery sheet says of its range (ADR 21 "Sheet content"): how well the battery kept what
// it took, and how many full cycles it ran. Pure, from the plant's flows (ADR 4, 14).
import { NEXT_TO_NOTHING } from "../history/breakdown.ts";
import { m } from "../paraglide/messages.js";
import type { Fact } from "./figures.ts";

/** A range's battery: kWh in and out, its state of charge in % at its ends, its capacity in kWh. */
export interface Throughput {
  readonly charged: number;
  readonly discharged: number;
  /** The first and the last read; null without one. */
  readonly soc: readonly [number, number] | null;
  readonly capacity: number | null;
}

/**
 * The round-trip efficiency in %: what it gave over what it took and did not keep. A range that
 * ends fuller or emptier than it began holds the difference, so a bare ratio would read low or
 * past 100 %. Null where the stored difference is unknown, from next to nothing, or past 100 %.
 */
export function roundTrip({ charged, discharged, soc, capacity }: Throughput): number | null {
  if (soc === null || capacity === null) return null;

  const kept = ((soc[1] - soc[0]) / 100) * capacity;
  const through = charged - kept;

  if (charged < NEXT_TO_NOTHING || through < NEXT_TO_NOTHING) return null;

  const pct = (discharged / through) * 100;

  return pct > 100 ? null : pct;
}

/** Full cycles: what it discharged over its capacity, as History counts them; null without one. */
export const cyclesOf = (discharged: number, capacity: number | null): number | null =>
  capacity === null || capacity <= 0 ? null : discharged / capacity;

/** The facts row: the round-trip efficiency and the cycles. */
export const factsOf = (efficiency: number | null, cycles: number | null): Fact[] => [
  { label: m.detail_round_trip(), value: efficiency, unit: "%", digits: 0 },
  { label: m.detail_cycles(), value: cycles, unit: "", digits: 1 },
];
