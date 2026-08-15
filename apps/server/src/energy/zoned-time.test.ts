import { describe, expect, test } from "bun:test";
import { startOfZonedDay, zonedDateKey, zonedFields, zonedIsoWeekday } from "./zoned-time";

// These helpers exist precisely so wall-clock bucketing stops depending on the
// server process zone (issue #46/#52). They read the zone ONLY from their `tz`
// argument, so a fixed instant + explicit zone must yield a fixed result no
// matter what the host process zone is — that is the host-independence the fix
// is about. (Tests avoid mutating process.env.TZ: bun caches the zone, so a flip
// leaks into later test files.)

const iso = (s: string) => new Date(s);

describe("zonedFields", () => {
  test("reads the wall-clock calendar fields from the given zone, not the host", () => {
    // 21:30Z in August is 23:30 in Berlin (CEST, +2) — still the 15th.
    const instant = iso("2026-08-15T21:30:00Z");
    expect(zonedFields(instant, "Europe/Berlin")).toEqual({
      year: 2026,
      month: 8,
      day: 15,
      hour: 23,
    });
  });

  test("the same instant lands on different calendar days across zones", () => {
    // 23:30Z on the 15th is already 01:30 on the 16th in Berlin — the exact
    // clock disagreement that misfiled a full day onto tomorrow's bar.
    const instant = iso("2026-08-15T23:30:00Z");
    expect(zonedFields(instant, "UTC")).toEqual({ year: 2026, month: 8, day: 15, hour: 23 });
    expect(zonedFields(instant, "Europe/Berlin")).toEqual({
      year: 2026,
      month: 8,
      day: 16,
      hour: 1,
    });
  });
});

describe("startOfZonedDay", () => {
  test("returns the UTC instant of local midnight for the day the instant falls in", () => {
    // 23:30 Berlin on the 15th → its local midnight is 2026-08-15T00:00 CEST = 22:00Z on the 14th.
    expect(startOfZonedDay(iso("2026-08-15T21:30:00Z"), "Europe/Berlin").toISOString()).toBe(
      "2026-08-14T22:00:00.000Z",
    );
    // 01:30 Berlin on the 16th → local midnight is 2026-08-16T00:00 CEST = 22:00Z on the 15th.
    expect(startOfZonedDay(iso("2026-08-15T23:30:00Z"), "Europe/Berlin").toISOString()).toBe(
      "2026-08-15T22:00:00.000Z",
    );
  });

  test("spans a 23-hour day across the spring-forward transition (Europe/Berlin)", () => {
    // 2026-03-29: clocks jump 02:00 → 03:00, so the calendar day is 23h long.
    const d29 = startOfZonedDay(iso("2026-03-29T12:00:00Z"), "Europe/Berlin");
    const d30 = startOfZonedDay(iso("2026-03-30T12:00:00Z"), "Europe/Berlin");
    expect(d29.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(d30.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(d30.getTime() - d29.getTime()).toBe(23 * 3_600_000);
  });

  test("spans a 25-hour day across the fall-back transition (Europe/Berlin)", () => {
    // 2026-10-25: clocks fall 03:00 → 02:00, so the calendar day is 25h long.
    const d25 = startOfZonedDay(iso("2026-10-25T12:00:00Z"), "Europe/Berlin");
    const d26 = startOfZonedDay(iso("2026-10-26T12:00:00Z"), "Europe/Berlin");
    expect(d25.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(d26.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(d26.getTime() - d25.getTime()).toBe(25 * 3_600_000);
  });
});

describe("zonedIsoWeekday / zonedDateKey", () => {
  test("weekday and date key follow the plant zone, not the host", () => {
    // 23:30Z Sat 15 Aug is already Sun 16 Aug 01:30 in Berlin.
    const instant = iso("2026-08-15T23:30:00Z");
    expect(zonedIsoWeekday(instant, "UTC")).toBe(6); // Saturday
    expect(zonedIsoWeekday(instant, "Europe/Berlin")).toBe(7); // Sunday
    expect(zonedDateKey(instant, "UTC")).toBe("2026-08-15");
    expect(zonedDateKey(instant, "Europe/Berlin")).toBe("2026-08-16");
  });
});
