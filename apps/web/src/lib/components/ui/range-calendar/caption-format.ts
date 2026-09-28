// The range calendar's caption, as plain functions. A `DateValue` is a
// zone-free calendar date; formatting it goes through an instant, and that
// instant and the clock it is read on must be the SAME zone — the one the range
// was built in (the plant's), not whatever zone the host happens to run in.
import { DateFormatter, type DateValue } from "@internationalized/date";

type MonthFormat = Intl.DateTimeFormatOptions["month"] | ((month: number) => string);
type YearFormat = Intl.DateTimeFormatOptions["year"] | ((year: number) => string);

/** The caption's month name for `date`, read on `timeZone`'s calendar. */
export function captionMonth(
  date: DateValue,
  format: MonthFormat,
  locale: string,
  timeZone: string,
): string {
  if (typeof format === "function") return format(date.month);
  return new DateFormatter(locale, { month: format, timeZone }).format(date.toDate(timeZone));
}

/** The caption's year for `date`, read on `timeZone`'s calendar. */
export function captionYear(
  date: DateValue,
  format: YearFormat,
  locale: string,
  timeZone: string,
): string {
  if (typeof format === "function") return format(date.year);
  return new DateFormatter(locale, { year: format, timeZone }).format(date.toDate(timeZone));
}
