// Plant-local calendar days as numbers since 1970-01-01, and how the range writes them.
import { getLocale } from "../paraglide/runtime.js";

const DAY_MS = 86_400_000;

/** A calendar day as a UTC date, formatted in UTC so it names that day anywhere. */
export const civil = (day: number): Date => new Date(day * DAY_MS);

export const dayOf = (y: number, month: number, d: number): number =>
  Date.UTC(y, month, d) / DAY_MS;

export const yearOf = (day: number): number => civil(day).getUTCFullYear();

/** The calendar day a `YYYY-MM-DD` names. */
export const dayOfIso = (s: string): number => Date.parse(`${s}T00:00Z`) / DAY_MS;

/** A calendar day as `YYYY-MM-DD`. */
export const iso = (day: number): string => civil(day).toISOString().slice(0, 10);

const OPTIONS = {
  dayLong: { weekday: "short", day: "numeric", month: "long" },
  dayLongYear: { weekday: "short", day: "numeric", month: "long", year: "numeric" },
  dayShort: { day: "numeric", month: "short" },
  dayShortYear: { day: "numeric", month: "short", year: "numeric" },
  weekday: { weekday: "short" },
  monthShort: { month: "short" },
  month: { month: "long" },
  monthYear: { month: "long", year: "numeric" },
  monthShortYear: { month: "short", year: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type Format = keyof typeof OPTIONS;

const cache = new Map<string, Intl.DateTimeFormat>();

/** A calendar day in one of the range's formats, in the SPA's locale. */
export function fmt(name: Format, day: number): string {
  const key = `${getLocale()}:${name}`;
  let format = cache.get(key);

  if (!format) {
    format = new Intl.DateTimeFormat(getLocale(), { timeZone: "UTC", ...OPTIONS[name] });
    cache.set(key, format);
  }

  return format.format(civil(day));
}

export const shortDay = (day: number, year = false): string =>
  fmt(year ? "dayShortYear" : "dayShort", day);

/** The ISO week number of a day. */
export function isoWeek(day: number): number {
  const thursday = day + 3 - ((civil(day).getUTCDay() + 6) % 7);

  return Math.floor((thursday - dayOf(yearOf(thursday), 0, 1)) / 7) + 1;
}
