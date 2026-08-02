import { afterAll, describe, expect, test } from "bun:test";
import { getLocale, overwriteGetLocale, type Locale } from "$lib/paraglide/runtime";
import { dayKeyDate, dayMonth, dayMonthYear, monthShort, weekdayDate } from "./date";
import { decimal } from "./number";

// The locale strategies (localStorage, Accept-Language, …) have nothing to read
// outside a browser, so drive the runtime's getter directly.
let locale: Locale = "en";
overwriteGetLocale(() => locale);
const useLocale = (next: Locale) => (locale = next);
afterAll(() => overwriteGetLocale(getLocale));

describe("date formatters", () => {
  test("follow the UI locale, not the runtime default", () => {
    const day = new Date(2026, 7, 2);
    useLocale("en");
    expect(dayMonth(day)).toBe("Aug 2");
    useLocale("de");
    expect(dayMonth(day)).toBe("2. Aug.");
  });

  test("a later locale switch is not served from the cache", () => {
    const day = new Date(2026, 0, 5);
    useLocale("en");
    expect(monthShort(day)).toBe("Jan");
    useLocale("fr");
    expect(monthShort(day)).toBe("janv.");
  });

  test("year and weekday variants", () => {
    useLocale("en");
    expect(dayMonthYear(new Date(2026, 6, 25))).toBe("Jul 25, 2026");
    expect(weekdayDate(new Date(2026, 7, 2))).toBe("Sunday, Aug 2");
  });

  test("numbers group the way the locale does", () => {
    useLocale("en");
    expect(decimal(1234.56, 1)).toBe("1,234.6");
    useLocale("de");
    expect(decimal(1234.56, 1)).toBe("1.234,6");
  });

  test("a day key parses to that calendar day", () => {
    const d = dayKeyDate("2026-08-02");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(2);
  });
});
