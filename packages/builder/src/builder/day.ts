import { getLocalTimeZone, today as todayIn } from "@internationalized/date";

/** Today as the builder holds a calendar day: `YYYY-MM-DD` in the browser's calendar. */
export function today(): string {
  return todayIn(getLocalTimeZone()).toString();
}
