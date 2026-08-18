/**
 * Calendar periods — day, week, month, year — resolved from DATE PARTS in an
 * explicit IANA zone, never from millisecond arithmetic.
 *
 * A civil day is not 86_400_000 ms. Across a spring-forward it is 23 hours and
 * across a fall-back 25, so `new Date(day.getTime() + 86_400_000)` either
 * overshoots an hour into the next day or drops the last hour of this one. Every
 * boundary here is built by asking the zone what its midnight is.
 *
 * NOT A FIX FOR THE PLANT-VS-DISPLAY TIMEZONE SPLIT (issue #46). This module is
 * deliberately zone-agnostic: the caller passes `timeZone` in, and choosing
 * WHICH zone — the plant's, for anything bucketed alongside server data, or the
 * viewer's, for rendering — stays the caller's problem. A default zone here, or
 * a `getPlantTimeZone()` import, would hand every caller one silent answer and
 * re-conflate the two zones #46 exists to keep apart.
 */

/** Granularity of a calendar period. */
export type Grain = "day" | "week" | "month" | "year";

/** A resolved calendar period. `end` is EXCLUSIVE — it is the next period's start. */
export type Period = { grain: Grain; start: Date; end: Date };

export interface PeriodOptions {
  /** IANA zone the calendar is read in, e.g. "Europe/Berlin". Required — see the module note. */
  timeZone: string;
  /** ISO weekday a week starts on: 1 = Monday (default), 7 = Sunday. */
  weekStartsOn?: 1 | 7;
}

/** A wall-clock calendar date, month 1-12. */
interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/** One `Intl.DateTimeFormat` per zone — constructing one is expensive. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * The wall clock at `ms` in `timeZone`, expressed as the UTC timestamp of those
 * same digits. The difference from `ms` is the zone's offset; equality with a
 * target says a wall clock resolves back to itself.
 */
function wallAsUtc(ms: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `h23` renders midnight as 00, but some engines have emitted 24 — normalise.
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
}

/** Signed offset (ms) of `timeZone` from UTC at `ms` — positive east of Greenwich. */
function offsetAt(ms: number, timeZone: string): number {
  return wallAsUtc(ms, timeZone) - ms;
}

/** The calendar date `instant` falls on in `timeZone`. */
function dateIn(instant: Date, timeZone: string): CalendarDate {
  const wall = wallAsUtc(instant.getTime(), timeZone);
  const d = new Date(wall);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The instant a skipped wall clock resolves to: the transition itself, i.e. the
 * first instant whose wall clock is past the gap. Found by bisecting to the
 * minute, since zone transitions land on whole minutes.
 */
function transitionBetween(before: number, after: number, timeZone: string): Date {
  const target = offsetAt(after, timeZone);
  let lo = before;
  let hi = after;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
    if (offsetAt(mid, timeZone) === target) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/**
 * Midnight starting `date` in `timeZone`, as an instant.
 *
 * The two zones-are-not-lines cases are resolved deliberately:
 *  - REPEATED midnight (Havana falls back 01:00 → 00:00): the FIRST occurrence,
 *    so the hour that happens twice sits inside the day, not before it.
 *  - SKIPPED midnight (Santiago springs forward 00:00 → 01:00): the transition,
 *    so the day starts at the first instant it actually has (01:00).
 *
 * Offsets are probed a day either side rather than at the wall clock read as
 * UTC: east of Greenwich that provisional instant already sits past a nearby
 * transition, and the earlier of two identical wall clocks would never be
 * generated.
 */
function midnightOf(date: CalendarDate, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day);
  const offsets = [offsetAt(wall - DAY, timeZone), offsetAt(wall + DAY, timeZone)];
  const candidates = [...new Set(offsets.map((o) => wall - o))];
  const resolves = candidates.filter((c) => wallAsUtc(c, timeZone) === wall);
  if (resolves.length > 0) return new Date(Math.min(...resolves));
  return transitionBetween(Math.min(...candidates), Math.max(...candidates), timeZone);
}

/** `date` shifted by whole calendar days, carrying month and year over. */
function shiftDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The first of the month `months` away from `date`'s month. */
function shiftMonths(date: CalendarDate, months: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: 1 };
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
function isoWeekday(date: CalendarDate): number {
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0 = Sunday
  return ((dow + 6) % 7) + 1;
}

/** The calendar date each grain's period begins on. */
const PERIOD_START: Record<Grain, (date: CalendarDate, weekStartsOn: 1 | 7) => CalendarDate> = {
  day: (date) => date,
  week: (date, weekStartsOn) => shiftDays(date, -((isoWeekday(date) - weekStartsOn + 7) % 7)),
  month: (date) => ({ year: date.year, month: date.month, day: 1 }),
  year: (date) => ({ year: date.year, month: 1, day: 1 }),
};

/** The calendar date the period AFTER the one starting at `start` begins on. */
const NEXT_PERIOD_START: Record<Grain, (start: CalendarDate) => CalendarDate> = {
  day: (start) => shiftDays(start, 1),
  week: (start) => shiftDays(start, 7),
  month: (start) => shiftMonths(start, 1),
  year: (start) => ({ year: start.year + 1, month: 1, day: 1 }),
};

/** Start of the `grain` period containing `instant`, in `opts.timeZone`. */
export function startOfPeriod(instant: Date, grain: Grain, opts: PeriodOptions): Date {
  const date = dateIn(instant, opts.timeZone);
  return midnightOf(PERIOD_START[grain](date, opts.weekStartsOn ?? 1), opts.timeZone);
}

/**
 * The `grain` period containing `instant` as `[start, end)`, in `opts.timeZone`.
 * `end` is the next period's start, so consecutive windows tile without a gap or
 * an overlap even across a DST transition.
 */
export function periodWindow(instant: Date, grain: Grain, opts: PeriodOptions): Period {
  const startDate = PERIOD_START[grain](dateIn(instant, opts.timeZone), opts.weekStartsOn ?? 1);
  return {
    grain,
    start: midnightOf(startDate, opts.timeZone),
    end: midnightOf(NEXT_PERIOD_START[grain](startDate), opts.timeZone),
  };
}
