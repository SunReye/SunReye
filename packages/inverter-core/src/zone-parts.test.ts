/**
 * The one wall-clock reader, at the instants where a naive one is wrong.
 *
 * Every case is an explicit UTC instant and an explicit zone: the process `TZ`
 * is never touched, because flipping it leaks into every later test file in the
 * run and takes the DST cases with it.
 */

import { describe, expect, test } from "bun:test";
import { wallClockAsUtc, zoneParts } from "./zone-parts";

const BERLIN = "Europe/Berlin";

describe("zoneParts", () => {
  test("reads the wall clock the zone shows, not the host's", () => {
    // 2026-01-15T12:34:56Z is 13:34:56 in Berlin (UTC+1).
    expect(zoneParts(BERLIN, Date.UTC(2026, 0, 15, 12, 34, 56))).toEqual({
      year: 2026,
      month: 1,
      day: 15,
      hour: 13,
      minute: 34,
      second: 56,
    });
  });

  test("summer time is read from the zone, not from a fixed offset", () => {
    // Same digits in July are UTC+2.
    expect(zoneParts(BERLIN, Date.UTC(2026, 6, 15, 12, 0, 0)).hour).toBe(14);
  });

  test("a zone west of Greenwich rolls the date back", () => {
    const p = zoneParts("America/New_York", Date.UTC(2026, 0, 15, 2, 30, 0));
    expect([p.year, p.month, p.day, p.hour]).toEqual([2026, 1, 14, 21]);
  });

  test("midnight is hour 0, never hour 24", () => {
    // The `% 24` normalisation: an engine emitting "24" would otherwise make
    // `Date.UTC` roll silently into the next day.
    expect(zoneParts(BERLIN, Date.UTC(2026, 0, 14, 23, 0, 0)).hour).toBe(0);
    expect(zoneParts(BERLIN, Date.UTC(2026, 0, 14, 23, 0, 0)).day).toBe(15);
  });

  test("a zone with a half-hour offset keeps its minutes", () => {
    expect(zoneParts("Asia/Kolkata", Date.UTC(2026, 0, 15, 12, 0, 0))).toMatchObject({
      hour: 17,
      minute: 30,
    });
  });
});

describe("wallClockAsUtc", () => {
  test("its distance from the instant IS the zone's offset", () => {
    const winter = Date.UTC(2026, 0, 15, 12, 0, 0);
    const summer = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(wallClockAsUtc(BERLIN, winter) - winter).toBe(3_600_000);
    expect(wallClockAsUtc(BERLIN, summer) - summer).toBe(2 * 3_600_000);
  });

  test("the offset changes across a spring-forward, within the same day", () => {
    // 2026-03-29 01:00Z is the transition in Berlin: 02:00 becomes 03:00.
    const before = Date.UTC(2026, 2, 29, 0, 30, 0);
    const after = Date.UTC(2026, 2, 29, 1, 30, 0);
    expect(wallClockAsUtc(BERLIN, before) - before).toBe(3_600_000);
    expect(wallClockAsUtc(BERLIN, after) - after).toBe(2 * 3_600_000);
  });

  test("and back across an autumn fall-back", () => {
    // 2026-10-25 01:00Z: 03:00 becomes 02:00.
    const before = Date.UTC(2026, 9, 25, 0, 30, 0);
    const after = Date.UTC(2026, 9, 25, 1, 30, 0);
    expect(wallClockAsUtc(BERLIN, before) - before).toBe(2 * 3_600_000);
    expect(wallClockAsUtc(BERLIN, after) - after).toBe(3_600_000);
  });

  test("seconds survive — the offset of a zone that has none is still exact", () => {
    const at = Date.UTC(2026, 0, 15, 12, 0, 42);
    expect(wallClockAsUtc("UTC", at)).toBe(at);
  });
});
