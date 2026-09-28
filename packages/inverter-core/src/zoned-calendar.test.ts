/**
 * Calendar boundaries in an explicit zone, at the instants where millisecond
 * arithmetic is wrong: DST seams both ways, midnight itself, month and year
 * edges, zones west of Greenwich and a half-hour zone.
 *
 * Every case is an explicit UTC instant and an explicit zone — the process `TZ`
 * is never touched (bun caches it, and a flip leaks into later files).
 */

import { describe, expect, test } from "bun:test";
import {
  dateKey,
  dayStart,
  isoWeekday,
  nextDayStart,
  periodStart,
  periodWindow,
} from "./zoned-calendar";

const BERLIN = "Europe/Berlin";
const NEW_YORK = "America/New_York";
const LOS_ANGELES = "America/Los_Angeles";
const KOLKATA = "Asia/Kolkata";
const HOUR = 3_600_000;

const at = (iso: string): number => Date.parse(iso);
const isoOf = (d: Date): string => d.toISOString();

describe("dayStart / nextDayStart", () => {
  test("local midnight of the day an instant falls in, read in the zone", () => {
    // 21:30Z in August is 23:30 CEST on the 15th; 23:30Z is already the 16th.
    expect(isoOf(dayStart(at("2026-08-15T21:30:00Z"), BERLIN))).toBe("2026-08-14T22:00:00.000Z");
    expect(isoOf(dayStart(at("2026-08-15T23:30:00Z"), BERLIN))).toBe("2026-08-15T22:00:00.000Z");
  });

  test("accepts a Date as well as epoch ms", () => {
    expect(isoOf(dayStart(new Date("2026-08-15T21:30:00Z"), BERLIN))).toBe(
      "2026-08-14T22:00:00.000Z",
    );
  });

  test("midnight itself starts its own day; the millisecond before is the previous one", () => {
    const midnight = at("2026-08-14T22:00:00Z");
    expect(dayStart(midnight, BERLIN).getTime()).toBe(midnight);
    expect(dayStart(midnight - 1, BERLIN).getTime()).toBe(midnight - 24 * HOUR);
  });

  test("spring forward: the offset is resolved at midnight, not at now (23-hour day)", () => {
    const start = dayStart(at("2026-03-29T10:00:00Z"), BERLIN);
    const next = nextDayStart(at("2026-03-29T10:00:00Z"), BERLIN);
    expect(isoOf(start)).toBe("2026-03-28T23:00:00.000Z");
    expect(isoOf(next)).toBe("2026-03-29T22:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(23 * HOUR);
  });

  test("fall back: a 25-hour day, and both readings of the repeated hour belong to it", () => {
    const start = dayStart(at("2026-10-25T09:00:00Z"), BERLIN);
    const next = nextDayStart(at("2026-10-25T09:00:00Z"), BERLIN);
    expect(isoOf(start)).toBe("2026-10-24T22:00:00.000Z");
    expect(isoOf(next)).toBe("2026-10-25T23:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(25 * HOUR);
    // 00:30Z and 01:30Z are the first and second 02:30.
    expect(dayStart(at("2026-10-25T00:30:00Z"), BERLIN).getTime()).toBe(start.getTime());
    expect(dayStart(at("2026-10-25T01:30:00Z"), BERLIN).getTime()).toBe(start.getTime());
  });

  test("west of Greenwich: New York's spring-forward day is 23 hours", () => {
    const start = dayStart(at("2026-03-08T20:00:00Z"), NEW_YORK);
    expect(isoOf(start)).toBe("2026-03-08T05:00:00.000Z");
    expect(isoOf(nextDayStart(start, NEW_YORK))).toBe("2026-03-09T04:00:00.000Z");
  });

  test("west of Greenwich: late evening local is still the previous UTC-less day", () => {
    // 03:30Z on the 16th is 20:30 PDT on the 15th.
    expect(isoOf(dayStart(at("2026-08-16T03:30:00Z"), LOS_ANGELES))).toBe(
      "2026-08-15T07:00:00.000Z",
    );
  });

  test("a half-hour zone starts its day on the half hour", () => {
    // 18:29Z is 23:59 IST; 18:30Z is the next midnight.
    expect(isoOf(dayStart(at("2026-08-15T18:29:00Z"), KOLKATA))).toBe("2026-08-14T18:30:00.000Z");
    expect(isoOf(dayStart(at("2026-08-15T18:30:00Z"), KOLKATA))).toBe("2026-08-15T18:30:00.000Z");
  });

  test("a skipped midnight starts the day at the first instant it has", () => {
    // Santiago springs forward at 00:00 on 2026-09-06: the day begins at 01:00 (04:00Z).
    expect(isoOf(dayStart(at("2026-09-06T15:00:00Z"), "America/Santiago"))).toBe(
      "2026-09-06T04:00:00.000Z",
    );
    expect(isoOf(nextDayStart(at("2026-09-05T15:00:00Z"), "America/Santiago"))).toBe(
      "2026-09-06T04:00:00.000Z",
    );
  });

  test("a repeated midnight starts the day at its first occurrence", () => {
    // Havana falls back at 01:00 on 2026-11-01, so 00:00 happens at 04:00Z and 05:00Z.
    expect(isoOf(dayStart(at("2026-11-01T18:00:00Z"), "America/Havana"))).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });
});

describe("dateKey / isoWeekday", () => {
  test("follow the zone's calendar, not UTC's", () => {
    // 23:30Z Sat 15 Aug is Sun 16 Aug 01:30 in Berlin, and Sat 19:30 in New York.
    const t = at("2026-08-15T23:30:00Z");
    expect(dateKey(t, "UTC")).toBe("2026-08-15");
    expect(dateKey(t, BERLIN)).toBe("2026-08-16");
    expect(dateKey(t, NEW_YORK)).toBe("2026-08-15");
    expect(isoWeekday(t, "UTC")).toBe(6);
    expect(isoWeekday(t, BERLIN)).toBe(7);
  });

  test("pads single-digit months and days", () => {
    expect(dateKey(at("2026-01-05T12:00:00Z"), BERLIN)).toBe("2026-01-05");
  });
});

describe("periodStart / periodWindow", () => {
  test("month and year start at the zone's midnight, across the UTC year boundary", () => {
    // 23:30Z on 31 Dec is 00:30 on 1 Jan in Berlin — already the new month and year.
    const t = at("2025-12-31T23:30:00Z");
    expect(isoOf(periodStart(t, BERLIN, "month"))).toBe("2025-12-31T23:00:00.000Z");
    expect(isoOf(periodStart(t, BERLIN, "year"))).toBe("2025-12-31T23:00:00.000Z");
    // In New York it is still 18:30 on 31 Dec.
    expect(isoOf(periodStart(t, NEW_YORK, "year"))).toBe("2025-01-01T05:00:00.000Z");
  });

  test("a month window spans the DST seam inside it", () => {
    const w = periodWindow(at("2026-03-15T12:00:00Z"), BERLIN, "month");
    expect(isoOf(w.start)).toBe("2026-02-28T23:00:00.000Z");
    expect(isoOf(w.end)).toBe("2026-03-31T22:00:00.000Z");
  });

  test("a year window ends at next year's first midnight", () => {
    const w = periodWindow(at("2026-06-01T00:00:00Z"), KOLKATA, "year");
    expect(isoOf(w.start)).toBe("2025-12-31T18:30:00.000Z");
    expect(isoOf(w.end)).toBe("2026-12-31T18:30:00.000Z");
  });

  test("weeks start Monday by default, Sunday on request", () => {
    // Wed 2026-08-19 in Berlin.
    const t = at("2026-08-19T10:00:00Z");
    expect(isoOf(periodStart(t, BERLIN, "week"))).toBe("2026-08-16T22:00:00.000Z");
    expect(isoOf(periodStart(t, BERLIN, "week", 7))).toBe("2026-08-15T22:00:00.000Z");
  });

  test("an hour in a half-hour zone starts on the UTC half hour", () => {
    const w = periodWindow(at("2026-08-15T10:45:00Z"), KOLKATA, "hour");
    expect(isoOf(w.start)).toBe("2026-08-15T10:30:00.000Z");
    expect(isoOf(w.end)).toBe("2026-08-15T11:30:00.000Z");
  });

  test("spring forward: the hour before the gap ends where the gap resolves", () => {
    // 00:30Z is 01:30 CET; wall 02:00 never happens, so 01:00 ends at 01:00Z (03:00 CEST).
    const w = periodWindow(at("2026-03-29T00:30:00Z"), BERLIN, "hour");
    expect(isoOf(w.start)).toBe("2026-03-29T00:00:00.000Z");
    expect(isoOf(w.end)).toBe("2026-03-29T01:00:00.000Z");
  });

  test("fall back: the repeated wall hour is one two-hour period", () => {
    // Both 02:00s (00:00Z and 01:00Z) carry the same wall key, so they are one period.
    for (const t of ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"]) {
      const w = periodWindow(at(t), BERLIN, "hour");
      expect(isoOf(w.start)).toBe("2026-10-25T00:00:00.000Z");
      expect(isoOf(w.end)).toBe("2026-10-25T02:00:00.000Z");
    }
  });

  test("the day grain matches dayStart / nextDayStart", () => {
    const t = at("2026-10-25T09:00:00Z");
    const w = periodWindow(t, BERLIN, "day");
    expect(w.start.getTime()).toBe(dayStart(t, BERLIN).getTime());
    expect(w.end.getTime()).toBe(nextDayStart(t, BERLIN).getTime());
  });
});
