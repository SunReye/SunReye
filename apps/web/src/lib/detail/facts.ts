// The facts more than one sheet states of its range (ADR 21 "Sheet content"). Pure.
import { whenOf } from "../history/peaks.ts";
import type { Rolled } from "../history/history.ts";
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
