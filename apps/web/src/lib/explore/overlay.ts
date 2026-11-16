// Overlay mode's periods (ADR 22): the range and up to four more days or weeks, each drawn from its
// own plant-local start. A period runs in real time from there, so a 23-hour day ends early and a
// 25-hour day draws its repeated hour twice, in order. Pure: the pane renders, this decides.
import { plantInstant } from "../plant-day.ts";
import { civil, dayOf, dayOfIso, iso } from "../range/calendar.ts";
import { isCurrent, rangeFor, type Calendar, type Kind, type Range } from "../range/range.ts";
import type { Curve } from "./curve.ts";

/** What overlays: months and years are the fold's. */
export const OVERLAY_KINDS = ["day", "week"] as const satisfies readonly Kind[];

type OverlayKind = (typeof OVERLAY_KINDS)[number];

/** Beside the range: more cannot be told apart, and each is a read. */
const MAX_PICKED = 4;

const kindOf = (r: Range): OverlayKind => (r.kind === "week" ? "week" : "day");

/** The range overlay opens on: a day or week as it is, else today if it holds it, else its last day. */
export function overlayRange(cal: Calendar, r: Range): Range {
  if (r.kind === "day" || r.kind === "week") return r;

  return rangeFor("day", isCurrent(cal, r) ? cal.today : Math.min(r.to - 1, cal.last));
}

export interface Period {
  /** Its first day, `2026-11-09`. */
  readonly key: string;
  readonly range: Range;
  /** [from, to) in epoch ms. */
  readonly from: number;
  readonly to: number;
}

/** The periods the picked days stand for, as their first days: each once, never the range's own. */
function firstDays(range: Range, picked: readonly string[]): number[] {
  const days = picked.map((day) => rangeFor(kindOf(range), dayOfIso(day)).from);

  return [...new Set(days)].filter((from) => from !== range.from).slice(0, MAX_PICKED);
}

/** The range, then the picked periods from the latest back. */
export function periodsOf(zone: string, range: Range, picked: readonly string[]): Period[] {
  const earlier = firstDays(range, picked)
    .toSorted((a, b) => b - a)
    .map((from) => rangeFor(kindOf(range), from));

  return [range, ...earlier].map((r) => ({
    key: iso(r.from),
    range: r,
    from: plantInstant(zone, r.from, 0).getTime(),
    to: plantInstant(zone, r.to, 0).getTime(),
  }));
}

/** How long the time axis runs: as long as the longest period. */
export const spanOf = (periods: readonly Period[]): number =>
  Math.max(...periods.map((p) => p.to - p.from));

/** A period's curve drawn from `onto`, the range's start, instead of its own. */
export function aligned(curve: Curve, period: Period, onto: number): Curve {
  const by = onto - period.from;

  return by === 0
    ? curve
    : { ...curve, samples: curve.samples.map((s) => ({ ...s, t0: s.t0 + by, t1: s.t1 + by })) };
}

export interface Pick {
  readonly id: "day" | "week" | "year";
  /** A day in the period it picks. */
  readonly day: string;
}

/** The quick picks beside any date: the day before, the week before, the same day last year. */
export function picksOf(range: Range): Pick[] {
  const from = range.from;
  const week: Pick = { id: "week", day: iso(from - 7) };

  // 52 weeks back is a Monday again.
  if (kindOf(range) === "week") return [week, { id: "year", day: iso(from - 364) }];

  const d = civil(from);

  return [
    { id: "day", day: iso(from - 1) },
    week,
    { id: "year", day: iso(dayOf(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate())) },
  ];
}

/** The picked days with `day`'s period; null when it is drawn already or the chart is full. */
export function added(range: Range, picked: readonly string[], day: string): string[] | null {
  const had = firstDays(range, picked);
  const from = rangeFor(kindOf(range), dayOfIso(day)).from;

  if (from === range.from || had.includes(from) || had.length >= MAX_PICKED) return null;

  return [...picked, day];
}

/** The picked days without those in `period`. */
export function removed(range: Range, picked: readonly string[], period: Period): string[] {
  return picked.filter(
    (day) => rangeFor(kindOf(range), dayOfIso(day)).from !== period.range.from,
  );
}

/** Period `i`'s colour: the range in the series' own, each earlier one fainter. */
export function tintOf(colour: string, i: number): string {
  const share = [100, 60, 42, 30, 22][i] ?? 22;

  return share === 100 ? colour : `color-mix(in oklab, ${colour} ${share}%, transparent)`;
}
