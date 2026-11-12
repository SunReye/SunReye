// What a range is measured against: the period before, or the same dates a year earlier, over
// as much of it as the range has run.
import { civil, dayOf } from "../range/calendar.ts";
import { rangeFor, step, t0Of, t1Of, type Calendar, type Range } from "../range/range.ts";
import type { Compare } from "./view.ts";

/** The baseline range and the hours of it compared, [t0, t1). */
export interface Baseline {
  readonly range: Range;
  readonly hours: readonly [number, number];
}

/** The same calendar date a year earlier. */
function yearBefore(day: number): number {
  const d = civil(day);

  return dayOf(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate());
}

function shifted(r: Range): Range {
  if (r.kind === "week") return rangeFor("week", r.from - 364);

  if (r.kind === "custom") {
    const by = r.from - yearBefore(r.from);

    return { ...r, from: r.from - by, to: r.to - by };
  }

  return rangeFor(r.kind, yearBefore(r.from));
}

export function baselineOf(cal: Calendar, r: Range, cmp: Compare): Baseline {
  const range = cmp === "year" && r.kind !== "year" ? shifted(r) : step(cal, r, -1);
  const now = cal.today * 24 + cal.hour;
  const ran = Math.min(t1Of(r), now) - t0Of(r);
  const t0 = t0Of(range);

  return { range, hours: [t0, Math.min(t1Of(range), t0 + Math.max(0, ran))] };
}
