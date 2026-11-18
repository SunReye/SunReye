// The facts more than one sheet states of its range (ADR 21 "Sheet content"). Pure.
import { whenOf } from "../history/peaks.ts";
import type { Rolled } from "../history/history.ts";
import { m } from "../paraglide/messages.js";
import { euroDigits } from "../range/format.ts";
import type { Fact } from "./figures.ts";

/** Where the range stands: its bands are hours, and the plant's timezone. */
export interface RangeAt {
  readonly hours: boolean;
  readonly zone: string;
}

/** A rollup's highest reading in `unit`, noted with its hour or, past a day, its day. */
export function peakFact(
  label: string,
  top: Readonly<Rolled> | null,
  unit: string,
  at: Readonly<RangeAt>,
): Fact {
  return {
    label,
    value: top?.max ?? null,
    unit,
    digits: 0,
    ...(top && { note: whenOf(top.start, at.hours, at.zone) }),
  };
}

/** Euros, as the range's money reads them. */
export const euros = (label: string, value: number | null): Fact => ({
  label,
  value,
  unit: "€",
  digits: euroDigits(value ?? 0),
});

/** The share of a load PV met directly, the battery's part not PV's, in %; null without one. */
export const pvCoveredFact = (share: number | null): Fact => ({
  label: m.detail_pv_covered(),
  value: share,
  unit: "%",
  digits: 0,
});
