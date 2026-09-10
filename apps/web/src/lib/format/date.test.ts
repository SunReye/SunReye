import { afterEach, describe, expect, test } from "bun:test";
import { type Locale, overwriteGetLocale } from "$lib/paraglide/runtime";
import { dateTime, dayKeyDate, weekdayShortDate } from "./date";

// Same arrangement as format.test.ts: the locale strategies (localStorage,
// Accept-Language, …) have nothing to read outside a browser, so drive the
// runtime's getter directly, and hand the base locale back after every test —
// the whole suite shares one process.
let locale: Locale = "en";
overwriteGetLocale(() => locale);
const useLocale = (next: Locale) => (locale = next);
afterEach(() => (locale = "en"));

describe("weekdayShortDate", () => {
  test("spells the month out rather than numbering it", () => {
    // The negative-window headers used to read "SUN, 08/02", which is 8 February
    // to half the people who see it. A spelled month cannot be misread.
    const header = weekdayShortDate(new Date(2026, 7, 2));
    expect(header).toBe("Sun, Aug 2");
    expect(header).not.toContain("/");
  });

  test("follows the UI locale, not the runtime default", () => {
    const day = new Date(2026, 7, 2);
    useLocale("de");
    expect(weekdayShortDate(day)).toBe("So., 2. Aug.");
    useLocale("fr");
    expect(weekdayShortDate(day)).toBe("dim. 2 août");
  });

  test("names the weekday the date actually falls on", () => {
    // A window header that says Sunday over Monday's prices is worse than none.
    useLocale("en");
    expect(weekdayShortDate(new Date(2026, 7, 3))).toBe("Mon, Aug 3");
    expect(weekdayShortDate(new Date(2025, 11, 31))).toBe("Wed, Dec 31");
  });
});

describe("dayKeyDate", () => {
  test("a day key keeps its calendar day through a clock change", () => {
    // Parsed at midnight, the spring-forward key would land in the hour that
    // does not exist locally and the header could slide a day. Noon has an hour
    // either side of it in every zone.
    const spring = dayKeyDate("2026-03-29");
    expect([spring.getFullYear(), spring.getMonth(), spring.getDate()]).toEqual([2026, 2, 29]);
    const autumn = dayKeyDate("2026-10-25");
    expect([autumn.getFullYear(), autumn.getMonth(), autumn.getDate()]).toEqual([2026, 9, 25]);
  });

  test("parses as local time, so the day never shifts with the offset", () => {
    const day = dayKeyDate("2026-08-02");
    expect(day.getHours()).toBe(12);
    expect(day.getDate()).toBe(2);
  });

  test("carries a leap day and a year boundary intact", () => {
    const leap = dayKeyDate("2028-02-29");
    expect([leap.getMonth(), leap.getDate()]).toEqual([1, 29]);
    const newYear = dayKeyDate("2027-01-01");
    expect([newYear.getFullYear(), newYear.getMonth(), newYear.getDate()]).toEqual([2027, 0, 1]);
  });

  test("a day key is printable by the header it feeds", () => {
    // The two are always used together: `weekdayShortDate(dayKeyDate(key))`.
    useLocale("en");
    expect(weekdayShortDate(dayKeyDate("2026-08-02"))).toBe("Sun, Aug 2");
  });
});

/**
 * A moment, not a day.
 *
 * "Last connected" and "last error at" are the two facts that make a connection
 * status actionable — "it dropped four seconds ago" and "it dropped in March"
 * are different problems — and a date with no clock time cannot tell them
 * apart. Everything else in this file formats a calendar day, so this is its
 * own export rather than an option on one of them.
 */
describe("dateTime", () => {
  test("carries the clock time, not only the day", () => {
    const at = new Date(2026, 8, 10, 14, 5);
    const shown = dateTime(at);
    expect(shown).toContain("14:05");
    expect(shown).toContain("Sep");
  });

  test("follows the UI locale, not the runtime default", () => {
    const at = new Date(2026, 8, 10, 14, 5);
    useLocale("de");
    expect(dateTime(at)).toBe("10. Sept. 2026, 14:05");
    useLocale("en");
    expect(dateTime(at)).toBe("Sep 10, 2026, 14:05");
  });

  // The two callers hand it an ISO string straight off the wire, and a null one
  // is a real state — a connection that has never opened, an integration that
  // has never failed. Formatting `null` as "Invalid Date" is worse than saying
  // nothing.
  test("an absent moment formats as nothing at all", () => {
    expect(dateTime(null)).toBeNull();
  });

  test("an unparseable moment formats as nothing rather than 'Invalid Date'", () => {
    expect(dateTime("not a date")).toBeNull();
  });

  test("an ISO string is accepted as readily as a Date", () => {
    useLocale("en");
    expect(dateTime(new Date(2026, 8, 10, 14, 5).toISOString())).toBe("Sep 10, 2026, 14:05");
  });
});
