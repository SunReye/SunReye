// Overlay mode's periods (ADR 22): the range and up to four more days or weeks, each drawn from its
// own plant-local start. A period runs in real time from there, so a 23-hour day ends early and a
// 25-hour day draws its repeated hour twice, in order. Pure: the pane renders, this decides.
import { plantInstant } from "../plant-day.ts";
import { civil, dayOf, dayOfIso, iso, isoWeek, yearOf } from "../range/calendar.ts";
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

export interface OverlayPeriod {
  /** Its first day, `2026-11-09`. */
  readonly key: string;
  readonly range: Range;
  /** [from, to) in epoch ms. */
  readonly from: number;
  readonly to: number;
}

/** Monday of ISO week `week` of `year`, or of its last week when it has fewer. */
function weekOfYear(year: number, week: number): number {
  const jan4 = dayOf(year, 0, 4);
  const first = jan4 - ((civil(jan4).getUTCDay() + 6) % 7);

  return first + 7 * (Math.min(week, isoWeek(dayOf(year, 11, 28))) - 1);
}

/** The range's period a year before: the same date, or for a week the same ISO week. */
function yearBefore(range: Range): number {
  if (kindOf(range) === "week") return weekOfYear(yearOf(range.from + 3) - 1, isoWeek(range.from));

  const d = civil(range.from);
  const month = d.getUTCMonth();
  // 29 February a year before is the 28th: day 0 of the next month is its last.
  const last = civil(dayOf(d.getUTCFullYear() - 1, month + 1, 0)).getUTCDate();

  return dayOf(d.getUTCFullYear() - 1, month, Math.min(d.getUTCDate(), last));
}

/** A quick pick as the route holds it: an offset from the range, so a current range stays relative. */
const OFFSETS = {
  "-1d": (range: Range) => range.from - 1,
  "-1w": (range: Range) => range.from - 7,
  "-1y": yearBefore,
} as const;

export type Offset = keyof typeof OFFSETS;

const isOffset = (entry: string): entry is Offset => Object.hasOwn(OFFSETS, entry);

/** A day in the period a route entry names: an offset from the range, or a date as it is. */
const dayIn = (range: Range, entry: string): number =>
  isOffset(entry) ? OFFSETS[entry](range) : dayOfIso(entry);

/** The first day of the period an entry names. */
const startOf = (range: Range, entry: string): number =>
  rangeFor(kindOf(range), dayIn(range, entry)).from;

/** The periods the picked entries stand for, as their first days: each once, never the range's own. */
function firstDays(range: Range, picked: readonly string[]): number[] {
  const days = picked.map((entry) => startOf(range, entry));

  return [...new Set(days)].filter((from) => from !== range.from).slice(0, MAX_PICKED);
}

/** The range, then the picked periods from the latest back. */
export function periodsOf(zone: string, range: Range, picked: readonly string[]): OverlayPeriod[] {
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
export const spanOf = (periods: readonly OverlayPeriod[]): number =>
  Math.max(...periods.map((p) => p.to - p.from));

/** A period's curve drawn from `onto`, the range's start, instead of its own. */
export function aligned(curve: Curve, period: OverlayPeriod, onto: number): Curve {
  const by = onto - period.from;

  return by === 0
    ? curve
    : { ...curve, samples: curve.samples.map((s) => ({ ...s, t0: s.t0 + by, t1: s.t1 + by })) };
}

export interface QuickPick {
  readonly id: "day" | "week" | "year";
  /** The offset the route holds it by, `-1d`. */
  readonly entry: Offset;
}

/** The quick picks beside any date: the day before, the week before, the same day last year. */
export function picksOf(range: Range): QuickPick[] {
  const picks: QuickPick[] = [
    { id: "week", entry: "-1w" },
    { id: "year", entry: "-1y" },
  ];

  return kindOf(range) === "week" ? picks : [{ id: "day", entry: "-1d" }, ...picks];
}

/** The picked entries with `entry`'s period; null when it is drawn already or the chart is full. */
export function added(range: Range, picked: readonly string[], entry: string): string[] | null {
  const had = firstDays(range, picked);
  const from = startOf(range, entry);

  if (from === range.from || had.includes(from) || had.length >= MAX_PICKED) return null;

  return [...picked, entry];
}

/** The picked entries without those that name `period`. */
export function removed(range: Range, picked: readonly string[], period: OverlayPeriod): string[] {
  return picked.filter((entry) => startOf(range, entry) !== period.range.from);
}

/** OverlayPeriod `i`'s colour: the range in the series' own, each earlier one fainter. */
export function tintOf(colour: string, i: number): string {
  const share = [100, 60, 42, 30, 22][i] ?? 22;

  return share === 100 ? colour : `color-mix(in oklab, ${colour} ${share}%, transparent)`;
}
