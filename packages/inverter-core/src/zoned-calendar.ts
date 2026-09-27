/**
 * Calendar boundaries — hour, day, week, month, year — in an explicit IANA zone,
 * resolved from the zone's WALL CLOCK, never from millisecond arithmetic: a civil
 * day is 23 or 25 hours across a DST seam. The one implementation the server's
 * rollups, the spot-price day and the web's period navigator all stand on. The
 * zone is always required: which zone (plant, market, viewer) is the caller's call.
 */

import { wallClockAsUtc, zoneParts } from "./zone-parts";

/** Granularity of a calendar period. */
export type CalendarGrain = "hour" | "day" | "week" | "month" | "year";

/** An instant, as a Date or epoch milliseconds. */
export type Instant = Date | number;

/** A wall-clock calendar date, month 1-12. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const msOf = (t: Instant): number => (typeof t === "number" ? t : t.getTime());

/** Signed offset (ms) of `timeZone` from UTC at `ms` — positive east of Greenwich. */
function offsetAt(ms: number, timeZone: string): number {
  return wallClockAsUtc(timeZone, ms) - ms;
}

/**
 * The instant a skipped wall clock resolves to: the transition itself, i.e. the
 * first instant whose wall clock is past the gap. Bisected to the minute, since
 * zone transitions land on whole minutes.
 */
function transitionBetween(before: number, after: number, timeZone: string): number {
  const target = offsetAt(after, timeZone);
  let lo = before;
  let hi = after;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
    if (offsetAt(mid, timeZone) === target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The instant a wall clock (its digits read as UTC ms) happens in `timeZone`.
 *
 *  - REPEATED (a fall-back hour, Havana's midnight): the FIRST occurrence, so
 *    the time that happens twice sits inside the period it names.
 *  - SKIPPED (a spring-forward hour, Santiago's midnight): the transition, the
 *    first instant past the gap.
 *
 * Offsets are probed a day either side rather than at the wall clock read as
 * UTC: east of Greenwich that provisional instant already sits past a nearby
 * transition, and the earlier of two identical wall clocks would never be seen.
 */
export function wallInstant(wallMs: number, timeZone: string): Date {
  const offsets = [offsetAt(wallMs - DAY, timeZone), offsetAt(wallMs + DAY, timeZone)];
  const candidates = [...new Set(offsets.map((o) => wallMs - o))];
  const resolves = candidates.filter((c) => wallClockAsUtc(timeZone, c) === wallMs);
  if (resolves.length > 0) return new Date(Math.min(...resolves));
  return new Date(transitionBetween(Math.min(...candidates), Math.max(...candidates), timeZone));
}

/** The calendar date `t` falls on in `timeZone`. */
export function calendarDate(t: Instant, timeZone: string): CalendarDate {
  const { year, month, day } = zoneParts(timeZone, msOf(t));
  return { year, month, day };
}

/** Midnight starting `date` in `timeZone`, as an instant. */
export function startOfDate(date: CalendarDate, timeZone: string): Date {
  return wallInstant(Date.UTC(date.year, date.month - 1, date.day), timeZone);
}

/** Local midnight starting the day `t` falls in. */
export function dayStart(t: Instant, timeZone: string): Date {
  return startOfDate(calendarDate(t, timeZone), timeZone);
}

/** Local midnight ending the day `t` falls in — the next day's start. */
export function nextDayStart(t: Instant, timeZone: string): Date {
  const { year, month, day } = calendarDate(t, timeZone);
  return wallInstant(Date.UTC(year, month - 1, day + 1), timeZone);
}

/** `YYYY-MM-DD` of the day `t` falls on in `timeZone`. */
export function dateKey(t: Instant, timeZone: string): string {
  const { year, month, day } = calendarDate(t, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of the day `t` falls on in `timeZone`. */
export function isoWeekday(t: Instant, timeZone: string): number {
  const { year, month, day } = calendarDate(t, timeZone);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return ((dow + 6) % 7) + 1;
}

/** Wall clock (as UTC ms) each grain's period containing wall clock `w` starts on. */
function wallPeriodStart(w: number, grain: CalendarGrain, weekStartsOn: 1 | 7): number {
  const d = new Date(w);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  if (grain === "hour") return Math.floor(w / HOUR) * HOUR;
  if (grain === "month") return Date.UTC(y, mo, 1);
  if (grain === "year") return Date.UTC(y, 0, 1);
  const day = Date.UTC(y, mo, d.getUTCDate());
  if (grain === "day") return day;
  const iso = ((d.getUTCDay() + 6) % 7) + 1;
  return day - ((iso - weekStartsOn + 7) % 7) * DAY;
}

/** Wall clock (as UTC ms) of the period after the one starting at wall clock `start`. */
function wallNextStart(start: number, grain: CalendarGrain): number {
  const d = new Date(start);
  if (grain === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (grain === "year") return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  // Wall-clock hours and days are fixed lengths: DST lives in wallInstant.
  const step = { hour: HOUR, day: DAY, week: 7 * DAY }[grain];
  return start + step;
}

/** Start of the `grain` period containing `t`. Weeks start Monday unless `weekStartsOn` is 7. */
export function periodStart(
  t: Instant,
  timeZone: string,
  grain: CalendarGrain,
  weekStartsOn: 1 | 7 = 1,
): Date {
  return wallInstant(
    wallPeriodStart(wallClockAsUtc(timeZone, msOf(t)), grain, weekStartsOn),
    timeZone,
  );
}

/**
 * The `grain` period containing `t`, as `[start, end)`. `end` is the next
 * period's start, so consecutive windows tile without gap or overlap across a
 * DST seam — and a repeated wall hour is ONE period, as its key is one key.
 */
export function periodWindow(
  t: Instant,
  timeZone: string,
  grain: CalendarGrain,
  weekStartsOn: 1 | 7 = 1,
): { start: Date; end: Date } {
  const start = wallPeriodStart(wallClockAsUtc(timeZone, msOf(t)), grain, weekStartsOn);
  return {
    start: wallInstant(start, timeZone),
    end: wallInstant(wallNextStart(start, grain), timeZone),
  };
}
