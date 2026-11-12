// The one time range of History, Forecast and Tariff (ADR 21), on the plant-local calendar
// (ADR 3): days are counted since 1970-01-01, hours since that day's midnight. The range lives in
// the hash route, so back and links restore it.
import { m } from "../paraglide/messages.js";
import { plantInstant, plantNow } from "../plant-day.ts";
import { civil, dayOf, fmt, isoWeek, shortDay, yearOf } from "./calendar.ts";

export type Kind = "day" | "week" | "month" | "year" | "custom";

export type Grain = "hour" | "day" | "week" | "month" | "year";

/** A window of plant-local days, end exclusive. */
export interface Range {
  readonly kind: Kind;
  readonly from: number;
  readonly to: number;
  /** Custom only: the hour the first day starts at and the hour the last day ends at. */
  readonly h0?: number;
  readonly h1?: number;
}

/** Where the screen stands: today, the running hour, and the last day it may show. */
export interface Calendar {
  readonly today: number;
  readonly hour: number;
  /** Today for what was measured; later for a forecast. */
  readonly last: number;
}

/** The calendar at the plant now; a screen of forecasts reaches `ahead` days past today. */
export function calendar(zone: string, now: Readonly<Date>, ahead = 0): Calendar {
  const { day, hour } = plantNow(zone, now);

  return { today: day, hour, last: day + ahead };
}

const KINDS: ReadonlySet<string> = new Set<Kind>(["day", "week", "month", "year", "custom"]);

export const isKind = (s: string | null): s is Kind => s !== null && KINDS.has(s);

/** The instant hour `t`, counted since 1970-01-01 on the plant's calendar, began in `zone`. */
export const hourInstant = (zone: string, t: number): Date =>
  plantInstant(zone, Math.floor(t / 24), t % 24);

/** The range as hours since 1970-01-01, [t0, t1). */
export const t0Of = (r: Range): number => r.from * 24 + (r.h0 ?? 0);
export const t1Of = (r: Range): number => (r.to - 1) * 24 + (r.h1 ?? 24);

export function rangeFor(kind: Exclude<Kind, "custom">, day: number): Range {
  const d = civil(day);

  if (kind === "day") return { kind, from: day, to: day + 1 };

  if (kind === "week") {
    const from = day - ((d.getUTCDay() + 6) % 7);

    return { kind, from, to: from + 7 };
  }

  if (kind === "month") {
    const [y, mo] = [d.getUTCFullYear(), d.getUTCMonth()];

    return { kind, from: dayOf(y, mo, 1), to: dayOf(y, mo + 1, 1) };
  }

  return { kind, from: dayOf(d.getUTCFullYear(), 0, 1), to: dayOf(d.getUTCFullYear() + 1, 0, 1) };
}

/** A custom range of whole days, inside what the screen reaches. */
export function customRange(cal: Calendar, from: number, to: number): Range {
  const a = Math.min(from, to, cal.last);
  const b = Math.min(cal.last + 1, Math.max(from, to));

  return { kind: "custom", from: a, to: Math.max(a + 1, b) };
}

/** A custom range between two hours; whole days carry no hours. */
export function spanRange(cal: Calendar, a: number, b: number): Range {
  const end = (cal.last + 1) * 24;
  const lo = Math.min(a, b, end - 1);
  const hi = Math.max(lo + 1, Math.min(end, Math.max(a, b)));
  const whole = { kind: "custom" as const, from: Math.floor(lo / 24), to: Math.ceil(hi / 24) };
  const [h0, h1] = [lo % 24, hi % 24];

  if (h0 && h1) return { ...whole, h0, h1 };

  if (h0) return { ...whole, h0 };

  return h1 ? { ...whole, h1 } : whole;
}

export function step(cal: Calendar, r: Range, dir: -1 | 1): Range {
  if (r.kind === "custom") {
    const len = t1Of(r) - t0Of(r);

    return spanRange(cal, t0Of(r) + dir * len, t1Of(r) + dir * len);
  }

  return rangeFor(r.kind, dir < 0 ? r.from - 1 : r.to);
}

export function canStep(cal: Calendar, r: Range, dir: -1 | 1): boolean {
  return dir > 0 ? r.to <= cal.last : true;
}

export function isCurrent(cal: Calendar, r: Range): boolean {
  return r.from <= cal.today && cal.today < r.to;
}

/** One range, as a key. */
export const rangeKey = (r: Range): string =>
  `${r.kind}:${r.from}:${r.to}:${r.h0 ?? ""}:${r.h1 ?? ""}`;

/** The stepper's label. */
export function rangeLabel(cal: Calendar, r: Range): string {
  return LABELS[r.kind](cal, r);
}

function dayLabel(cal: Calendar, r: Range): string {
  if (r.from === cal.today) return m.range_today();

  if (r.from === cal.today - 1) return m.range_yesterday();

  return fmt(yearOf(r.from) === yearOf(cal.today) ? "dayLong" : "dayLongYear", r.from);
}

function weekLabel(cal: Calendar, r: Range): string {
  if (isCurrent(cal, r)) return m.range_this_week();

  return m.range_week_label({
    week: isoWeek(r.from),
    from: shortDay(r.from),
    to: shortDay(r.to - 1, yearOf(r.from) !== yearOf(cal.today)),
  });
}

function customLabel(r: Range): string {
  if (r.h0 === undefined && r.h1 === undefined) {
    return `${shortDay(r.from, true)} – ${shortDay(r.to - 1, true)}`;
  }

  const [from, to] = [r.h0 ?? 0, r.h1 ?? 24];

  if (r.to - r.from === 1) return m.range_day_hours({ date: shortDay(r.from, true), from, to });

  return m.range_span_hours({
    from: shortDay(r.from),
    fromHour: from,
    to: shortDay(r.to - 1),
    toHour: to,
  });
}

const LABELS: Readonly<Record<Kind, (cal: Calendar, r: Range) => string>> = {
  day: dayLabel,
  week: weekLabel,
  month: (_, r) => fmt("monthYear", r.from),
  year: (_, r) => String(yearOf(r.from)),
  custom: (_, r) => customLabel(r),
};

export function grainOf(r: Range): Grain {
  const fixed = FIXED[r.kind];

  if (fixed) return fixed;

  if (t1Of(r) - t0Of(r) <= 62) return "hour";

  const days = r.to - r.from;

  return CUSTOM.find(([most]) => days <= most)?.[1] ?? "year";
}

/** The grain of each kind but custom. */
const FIXED: Readonly<Partial<Record<Kind, Grain>>> = {
  day: "hour",
  week: "day",
  month: "day",
  year: "month",
};

/** A custom range's grain by its days, so it keeps to about 62 bands. */
const CUSTOM: readonly (readonly [number, Grain])[] = [
  [62, "day"],
  [182, "week"],
  [1100, "month"],
];

/** A custom range's bounds as the range control edits them. `toHour` 24 is the end of the day. */
export interface Bounds {
  readonly from: string;
  readonly to: string;
  readonly fromHour: number;
  readonly toHour: number;
  readonly min: string;
  readonly max: string;
  readonly onchange: (from: string, to: string, fromHour: number, toHour: number) => void;
}

/** What the range control shows and drives; a screen's route is one. */
export interface Ranged {
  readonly range: Range;
  readonly label: string;
  /** Which way the last change went; the label rolls that way. */
  readonly via: Via;
  readonly canPrev: boolean;
  readonly canNext: boolean;
  readonly custom: Bounds;
  readonly setKind: (kind: Kind) => void;
  readonly step: (dir: -1 | 1) => void;
}

/** How a chart gets from one range to the next; `id` changes with every change of range. */
export interface Via {
  readonly id: number;
  readonly kind: "morph" | "zoom" | "none";
  /** Zoom: the inner range's span as shares of the outer range's plot. */
  readonly a: number;
  readonly b: number;
  /** Zoom: the new range lies inside the old one. */
  readonly inward: boolean;
  /** Which way a step went. */
  readonly dir: -1 | 0 | 1;
}

/**
 * A change of range, read off the two ranges and what made it: a step or a new kind morphs the
 * chart in place; a range inside the old one zooms in, one around it zooms out; the rest morph.
 */
export function travel(was: Range, next: Range, hint: "kind" | "step" | null): Omit<Via, "id"> {
  const [p0, p1, n0, n1] = [t0Of(was), t1Of(was), t0Of(next), t1Of(next)];
  const stepped = hint === "step" || (was.kind === next.kind && next.kind !== "custom");

  if (stepped) return { ...MORPH, dir: n0 >= p0 ? 1 : -1 };

  if (hint === "kind") return MORPH;

  if (n0 >= p0 && n1 <= p1) return zoom([p0, p1], [n0, n1], true);

  if (p0 >= n0 && p1 <= n1) return zoom([n0, n1], [p0, p1], false);

  return MORPH;
}

const MORPH = { kind: "morph", a: 0, b: 1, inward: true, dir: 0 } as const;

/** The inner span as shares of the outer one's plot. */
function zoom(
  [o0, o1]: readonly [number, number],
  [i0, i1]: readonly [number, number],
  inward: boolean,
): Omit<Via, "id"> {
  return { kind: "zoom", inward, a: (i0 - o0) / (o1 - o0), b: (i1 - o0) / (o1 - o0), dir: 0 };
}
