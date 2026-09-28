import { describe, expect, test } from "bun:test";
import { currentPeriodKey, eachPeriod } from "./period-keys";

/** The zone these host-local fixtures were written in. */
const HOST_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("currentPeriodKey", () => {
  test("names the period a moment falls in, at each granularity", () => {
    const at = new Date(2024, 5, 15, 9, 45);
    expect(currentPeriodKey("hour", at, HOST_TZ)).toBe("2024-06-15T09");
    expect(currentPeriodKey("day", at, HOST_TZ)).toBe("2024-06-15");
    expect(currentPeriodKey("month", at, HOST_TZ)).toBe("2024-06");
  });

  test("pads single-digit months, days and hours", () => {
    const at = new Date(2024, 0, 5, 3, 0);
    expect(currentPeriodKey("hour", at, HOST_TZ)).toBe("2024-01-05T03");
    expect(currentPeriodKey("day", at, HOST_TZ)).toBe("2024-01-05");
    expect(currentPeriodKey("month", at, HOST_TZ)).toBe("2024-01");
  });

  test("midnight belongs to the day that starts, not the one that ended", () => {
    expect(currentPeriodKey("hour", new Date(2024, 5, 15, 0, 0, 0), HOST_TZ)).toBe("2024-06-15T00");
    expect(currentPeriodKey("day", new Date(2024, 5, 15, 23, 59, 59), HOST_TZ)).toBe("2024-06-15");
  });

  test("an explicit plant zone decides the key, independent of the host zone", () => {
    // 23:30Z on the 15th is 01:30 on the 16th in Berlin — the exact clock
    // disagreement that misfiled a full day onto tomorrow's bar (issues #46/#52).
    // The key reads its zone only from the `tz` argument, so this holds whatever
    // the host zone is (no process.env.TZ mutation — bun caches the zone and a
    // flip would leak into later test files).
    const instant = new Date("2026-08-15T23:30:00Z");
    expect(currentPeriodKey("hour", instant, "Europe/Berlin")).toBe("2026-08-16T01");
    expect(currentPeriodKey("day", instant, "Europe/Berlin")).toBe("2026-08-16");
    expect(currentPeriodKey("month", instant, "Europe/Berlin")).toBe("2026-08");
    // A different plant zone lands on the previous day for the very same instant.
    expect(currentPeriodKey("day", instant, "UTC")).toBe("2026-08-15");
  });
});

describe("eachPeriod", () => {
  test("a fall-back day's repeated hour is ONE period spanning both of its hours", () => {
    // Berlin, 2026-10-25: both 02:00s (00:00Z and 01:00Z) carry the key T02, as
    // the SQL `to_char(... at time zone)` gives them — so one bar, two hours long.
    const periods = eachPeriod(
      new Date("2026-10-24T22:00:00Z"),
      new Date("2026-10-25T04:00:00Z"),
      "hour",
      "Europe/Berlin",
    );
    expect(periods.map((p) => p.key)).toEqual([
      "2026-10-25T00",
      "2026-10-25T01",
      "2026-10-25T02",
      "2026-10-25T03",
      "2026-10-25T04",
    ]);
    const repeated = periods[2];
    expect(repeated?.start.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(repeated?.end.toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });

  test("a spring-forward day has no 02:00 period", () => {
    const keys = eachPeriod(
      new Date("2026-03-28T23:00:00Z"),
      new Date("2026-03-29T03:00:00Z"),
      "hour",
      "Europe/Berlin",
    ).map((p) => p.key);
    expect(keys).toEqual(["2026-03-29T00", "2026-03-29T01", "2026-03-29T03", "2026-03-29T04"]);
  });
});
