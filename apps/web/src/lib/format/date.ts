// Locale-aware date formatting for the app's own copy.
//
// A German UI was printing "Sunday, Aug 2" and "SUN, 08/02" because every call
// site passed `undefined` as the locale. Everything here goes through the UI
// locale instead; see ./intl.ts for the caching.

import { localeFormatter } from "./intl";

const formatter = localeFormatter(
  (locale, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options),
);

const format = (date: Date, options: Intl.DateTimeFormatOptions): string =>
  formatter(options).format(date);

/** "Aug 1" — chart buckets and compact range labels. */
export const dayMonth = (date: Date): string => format(date, { day: "numeric", month: "short" });

/** "Aug" — monthly chart buckets. */
export const monthShort = (date: Date): string => format(date, { month: "short" });

/** "Aug 2, 2026" — record and extreme-day sub-lines, where the year matters. */
export const dayMonthYear = (date: Date): string =>
  format(date, { day: "numeric", month: "short", year: "numeric" });

/** "Sunday, Aug 2" — the day-ahead curve headings. */
export const weekdayDate = (date: Date): string =>
  format(date, { weekday: "long", day: "numeric", month: "short" });

/** "Sun, Aug 2" — the negative-window day headers. Spelled-out month rather
 *  than digits, because 08/02 reads as two different days either side of the
 *  Atlantic. */
export const weekdayShortDate = (date: Date): string =>
  format(date, { weekday: "short", day: "numeric", month: "short" });

/** Local midday of a `YYYY-MM-DD` key — parsing at noon keeps the calendar day
 *  intact under any timezone shift. */
export const dayKeyDate = (key: string): Date => new Date(`${key}T12:00:00`);

/**
 * "Sep 10, 2026, 14:05" — a MOMENT, day and clock time together.
 *
 * Everything above formats a calendar day. This exists for the two facts that
 * make a connection status actionable — when it last connected, and when it
 * last failed — where "four seconds ago" and "in March" are different problems
 * and a bare date cannot tell them apart.
 *
 * Takes what the wire actually carries (an ISO string, or nothing) as readily
 * as a `Date`, and answers null for an absent or unparseable one: "never
 * connected" and "nothing has failed" are real states, and rendering "Invalid
 * Date" at an operator is worse than saying nothing.
 */
export const dateTime = (at: Date | string | null | undefined): string | null => {
  if (at === null || at === undefined) return null;
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return null;
  return format(date, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
};
