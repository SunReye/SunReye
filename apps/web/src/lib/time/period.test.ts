import { describe, expect, it } from "bun:test";
import { periodWindow, startOfPeriod, type Grain } from "./period";

/**
 * Every assertion here reads the boundary back as WALL-CLOCK PARTS in the target
 * zone. Asserting the elapsed duration instead is the trap this module exists to
 * close: `start + 86_400_000` is 24 hours long on every day of the year, so a
 * duration test is green for exactly the code that is broken. Parts are the
 * claim — a day boundary is a midnight, whatever it cost in milliseconds.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function wall(instant: Date, timeZone: string): string {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    FORMATTERS.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const hour = String(Number(p.hour) % 24).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}`;
}

const BERLIN = "Europe/Berlin";
const GRAINS: Grain[] = ["day", "week", "month", "year"];

describe("startOfPeriod — day boundaries are civil midnights, not 24h blocks", () => {
  it("bounds Berlin's 23-hour spring-forward day at both midnights", () => {
    // 2026-03-29 loses 02:00–03:00 CET. `to = from + 86_400_000` would overshoot
    // into 01:00 on the 30th and swallow an hour of the next day.
    const w = periodWindow(new Date("2026-03-29T10:00:00Z"), "day", { timeZone: BERLIN });
    expect(wall(w.start, BERLIN)).toBe("2026-03-29 00:00");
    expect(wall(w.end, BERLIN)).toBe("2026-03-30 00:00");
    expect(w.grain).toBe("day");
  });

  it("bounds Berlin's 25-hour fall-back day at both midnights", () => {
    // 2026-10-25 repeats 02:00–03:00. `+ 86_400_000` would end at 23:00 and drop
    // the day's last hour on the floor.
    const w = periodWindow(new Date("2026-10-25T10:00:00Z"), "day", { timeZone: BERLIN });
    expect(wall(w.start, BERLIN)).toBe("2026-10-25 00:00");
    expect(wall(w.end, BERLIN)).toBe("2026-10-26 00:00");
  });

  it("rolls a day window over the end of a month", () => {
    const w = periodWindow(new Date("2026-01-31T12:00:00Z"), "day", { timeZone: BERLIN });
    expect(wall(w.start, BERLIN)).toBe("2026-01-31 00:00");
    expect(wall(w.end, BERLIN)).toBe("2026-02-01 00:00");
  });

  it("rolls December into January", () => {
    const day = periodWindow(new Date("2026-12-31T12:00:00Z"), "day", { timeZone: BERLIN });
    expect(wall(day.end, BERLIN)).toBe("2027-01-01 00:00");
    const month = periodWindow(new Date("2026-12-31T12:00:00Z"), "month", { timeZone: BERLIN });
    expect(wall(month.start, BERLIN)).toBe("2026-12-01 00:00");
    expect(wall(month.end, BERLIN)).toBe("2027-01-01 00:00");
  });

  it("keeps a half-hour zone on its own midnight", () => {
    const w = periodWindow(new Date("2026-05-14T20:00:00Z"), "day", { timeZone: "Asia/Kolkata" });
    expect(wall(w.start, "Asia/Kolkata")).toBe("2026-05-15 00:00");
    expect(w.start.toISOString()).toBe("2026-05-14T18:30:00.000Z");
  });
});

describe("startOfPeriod — the zone decides, and only the zone", () => {
  it("gives one instant three different day starts in three zones", () => {
    const instant = new Date("2026-05-14T23:30:00Z");
    const auckland = startOfPeriod(instant, "day", { timeZone: "Pacific/Auckland" });
    const utc = startOfPeriod(instant, "day", { timeZone: "UTC" });
    const la = startOfPeriod(instant, "day", { timeZone: "America/Los_Angeles" });

    expect(wall(auckland, "Pacific/Auckland")).toBe("2026-05-15 00:00");
    expect(wall(utc, "UTC")).toBe("2026-05-14 00:00");
    expect(wall(la, "America/Los_Angeles")).toBe("2026-05-14 00:00");
    expect(new Set([auckland, utc, la].map((d) => d.getTime())).size).toBe(3);
  });

  it("reads the year from the zone, not from the instant's UTC year", () => {
    // 2027 in UTC, still 2026 in New York — a `getUTCFullYear()` here would file
    // New Year's Eve under the wrong year.
    const instant = new Date("2027-01-01T02:00:00Z");
    const opts = { timeZone: "America/New_York" };
    expect(wall(startOfPeriod(instant, "day", opts), opts.timeZone)).toBe("2026-12-31 00:00");
    const year = periodWindow(instant, "year", opts);
    expect(wall(year.start, opts.timeZone)).toBe("2026-01-01 00:00");
    expect(wall(year.end, opts.timeZone)).toBe("2027-01-01 00:00");
  });
});

describe("startOfPeriod — weeks", () => {
  const wednesday = new Date("2026-05-13T09:00:00Z");
  const sunday = new Date("2026-05-17T09:00:00Z");

  it("starts a week on Monday by default", () => {
    expect(wall(startOfPeriod(wednesday, "week", { timeZone: BERLIN }), BERLIN)).toBe(
      "2026-05-11 00:00",
    );
  });

  it("keeps Sunday in the week that began the Monday before", () => {
    const w = periodWindow(sunday, "week", { timeZone: BERLIN, weekStartsOn: 1 });
    expect(wall(w.start, BERLIN)).toBe("2026-05-11 00:00");
    expect(wall(w.end, BERLIN)).toBe("2026-05-18 00:00");
  });

  it("starts a week on Sunday when asked", () => {
    const start = startOfPeriod(wednesday, "week", { timeZone: BERLIN, weekStartsOn: 7 });
    expect(wall(start, BERLIN)).toBe("2026-05-10 00:00");
    const w = periodWindow(sunday, "week", { timeZone: BERLIN, weekStartsOn: 7 });
    expect(wall(w.start, BERLIN)).toBe("2026-05-17 00:00");
    expect(wall(w.end, BERLIN)).toBe("2026-05-24 00:00");
  });

  it("spans a spring-forward week from midnight to midnight", () => {
    const w = periodWindow(new Date("2026-03-29T10:00:00Z"), "week", { timeZone: BERLIN });
    expect(wall(w.start, BERLIN)).toBe("2026-03-23 00:00");
    expect(wall(w.end, BERLIN)).toBe("2026-03-30 00:00");
  });
});

describe("startOfPeriod — ambiguous and skipped midnights", () => {
  const SANTIAGO = "America/Santiago";
  const HAVANA = "America/Havana";

  it("starts a skipped midnight at the first instant the day actually has", () => {
    // Santiago springs forward at 00:00 on 2026-09-06: the 6th begins at 01:00,
    // and 00:00 never happens. Resolving forward to the transition keeps the day
    // start inside its own day.
    const start = startOfPeriod(new Date("2026-09-06T15:00:00Z"), "day", { timeZone: SANTIAGO });
    expect(wall(start, SANTIAGO)).toBe("2026-09-06 01:00");
    expect(start.toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });

  it("leaves no hole between the skipped midnight and the day before it", () => {
    const before = periodWindow(new Date("2026-09-05T15:00:00Z"), "day", { timeZone: SANTIAGO });
    expect(wall(before.start, SANTIAGO)).toBe("2026-09-05 00:00");
    expect(before.end.toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });

  it("starts a repeated midnight at its FIRST occurrence", () => {
    // Havana falls back at 01:00 on 2026-11-01, so 00:00 happens twice (04:00Z
    // and 05:00Z). Taking the later one would leave the first hour of the day
    // outside the day.
    const start = startOfPeriod(new Date("2026-11-01T18:00:00Z"), "day", { timeZone: HAVANA });
    expect(wall(start, HAVANA)).toBe("2026-11-01 00:00");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("ends the day before a repeated midnight at that same first occurrence", () => {
    const before = periodWindow(new Date("2026-10-31T18:00:00Z"), "day", { timeZone: HAVANA });
    expect(before.end.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("resolves a day start from an instant inside a repeated hour", () => {
    // 2026-10-25T01:30Z is the SECOND 02:30 in Berlin; both readings of that wall
    // clock belong to the same civil day.
    const first = startOfPeriod(new Date("2026-10-25T00:30:00Z"), "day", { timeZone: BERLIN });
    const second = startOfPeriod(new Date("2026-10-25T01:30:00Z"), "day", { timeZone: BERLIN });
    expect(second.toISOString()).toBe(first.toISOString());
    expect(wall(first, BERLIN)).toBe("2026-10-25 00:00");
  });
});

describe("periodWindow — shape", () => {
  it("carries the grain and starts where startOfPeriod says", () => {
    const instant = new Date("2026-05-14T09:00:00Z");
    for (const grain of GRAINS) {
      const w = periodWindow(instant, grain, { timeZone: BERLIN });
      expect(w.grain).toBe(grain);
      expect(w.start.toISOString()).toBe(
        startOfPeriod(instant, grain, { timeZone: BERLIN }).toISOString(),
      );
      expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
    }
  });

  it("ends exclusively, exactly where the next period starts", () => {
    // Anchored on a DST day so the tiling is proved where the arithmetic breaks.
    const instant = new Date("2026-03-29T10:00:00Z");
    for (const grain of GRAINS) {
      const w = periodWindow(instant, grain, { timeZone: BERLIN });
      const next = periodWindow(w.end, grain, { timeZone: BERLIN });
      expect(next.start.toISOString()).toBe(w.end.toISOString());
    }
  });

  it("is idempotent — a period start resolves to itself", () => {
    for (const grain of GRAINS) {
      const start = startOfPeriod(new Date("2026-10-25T10:00:00Z"), grain, { timeZone: BERLIN });
      expect(startOfPeriod(start, grain, { timeZone: BERLIN }).toISOString()).toBe(
        start.toISOString(),
      );
    }
  });
});
