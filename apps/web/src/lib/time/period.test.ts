import { describe, expect, it } from "bun:test";
import {
  canStepForward,
  containsNow,
  periodLabel,
  periodOf,
  periodTitle,
  periodWindow,
  startOfPeriod,
  stepPeriod,
  switchGrain,
  weekStartFor,
  type Grain,
} from "./period";

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

describe("stepPeriod — the arrows", () => {
  it("steps a day across a spring-forward onto the NEXT CIVIL DAY", () => {
    // 2026-03-29 is 23 hours long in Berlin. A stepper that adds 86_400_000 ms
    // lands at 01:00 on the 30th — still "the next day" by duration, which is
    // why this asserts PARTS. The duration assertion is green for that bug.
    const march28 = periodWindow(new Date("2026-03-28T12:00:00Z"), "day", { timeZone: BERLIN });
    const next = stepPeriod(march28, 1, { timeZone: BERLIN });
    expect(wall(next.start, BERLIN)).toBe("2026-03-29 00:00");
    expect(wall(next.end, BERLIN)).toBe("2026-03-30 00:00");
    expect(next.grain).toBe("day");
  });

  it("steps back across a fall-back onto the previous civil day", () => {
    const oct26 = periodWindow(new Date("2026-10-26T12:00:00Z"), "day", { timeZone: BERLIN });
    const prev = stepPeriod(oct26, -1, { timeZone: BERLIN });
    expect(wall(prev.start, BERLIN)).toBe("2026-10-25 00:00");
    expect(wall(prev.end, BERLIN)).toBe("2026-10-26 00:00");
  });

  it("steps a week by seven civil days, DST week included", () => {
    const week = periodWindow(new Date("2026-03-25T12:00:00Z"), "week", { timeZone: BERLIN });
    const next = stepPeriod(week, 1, { timeZone: BERLIN });
    expect(wall(week.start, BERLIN)).toBe("2026-03-23 00:00");
    expect(wall(next.start, BERLIN)).toBe("2026-03-30 00:00");
    expect(wall(next.end, BERLIN)).toBe("2026-04-06 00:00");
  });

  it("keeps a Sunday-start week on Sundays when it steps", () => {
    const opts = { timeZone: BERLIN, weekStartsOn: 7 } as const;
    const week = periodWindow(new Date("2026-05-13T09:00:00Z"), "week", opts);
    const next = stepPeriod(week, 1, opts);
    expect(wall(next.start, BERLIN)).toBe("2026-05-17 00:00");
    expect(wall(next.end, BERLIN)).toBe("2026-05-24 00:00");
  });

  it("steps the month containing 31 March back into FEBRUARY", () => {
    const march = periodWindow(new Date("2026-03-31T12:00:00Z"), "month", { timeZone: BERLIN });
    const prev = stepPeriod(march, -1, { timeZone: BERLIN });
    expect(wall(prev.start, BERLIN)).toBe("2026-02-01 00:00");
    expect(wall(prev.end, BERLIN)).toBe("2026-03-01 00:00");
  });

  it("clamps a month step to the shorter month instead of overflowing past it", () => {
    // `Period` is a plain structure, and the anchor a caller hands back is not
    // always the 1st — a picker that remembers the reader's day while they
    // switch to the Month tab hands one back on the 31st. `new Date(y, m - 1, 31)`
    // for February overflows to 3 March, so the back arrow lands on March again
    // and reads as dead. 2024 clamps to the 29th, and still lands in February.
    const anchored = (year: number) => ({
      grain: "month" as const,
      start: startOfPeriod(new Date(`${year}-03-31T12:00:00Z`), "day", { timeZone: BERLIN }),
      end: startOfPeriod(new Date(`${year}-04-01T12:00:00Z`), "day", { timeZone: BERLIN }),
    });
    expect(wall(stepPeriod(anchored(2026), -1, { timeZone: BERLIN }).start, BERLIN)).toBe(
      "2026-02-01 00:00",
    );
    expect(wall(stepPeriod(anchored(2024), -1, { timeZone: BERLIN }).start, BERLIN)).toBe(
      "2024-02-01 00:00",
    );
  });

  it("rolls a month step over the turn of the year", () => {
    const dec = periodWindow(new Date("2026-12-15T12:00:00Z"), "month", { timeZone: BERLIN });
    expect(wall(stepPeriod(dec, 1, { timeZone: BERLIN }).start, BERLIN)).toBe("2027-01-01 00:00");
    const jan = periodWindow(new Date("2026-01-15T12:00:00Z"), "month", { timeZone: BERLIN });
    expect(wall(stepPeriod(jan, -1, { timeZone: BERLIN }).start, BERLIN)).toBe("2025-12-01 00:00");
  });

  it("steps a year, leap year included", () => {
    const y2024 = periodWindow(new Date("2024-02-29T12:00:00Z"), "year", { timeZone: BERLIN });
    const next = stepPeriod(y2024, 1, { timeZone: BERLIN });
    expect(wall(next.start, BERLIN)).toBe("2025-01-01 00:00");
    expect(wall(next.end, BERLIN)).toBe("2026-01-01 00:00");
  });

  it("steps by more than one, and a zero step is the same window", () => {
    const day = periodWindow(new Date("2026-05-14T09:00:00Z"), "day", { timeZone: BERLIN });
    expect(wall(stepPeriod(day, -3, { timeZone: BERLIN }).start, BERLIN)).toBe("2026-05-11 00:00");
    const same = stepPeriod(day, 0, { timeZone: BERLIN });
    expect(same.start.toISOString()).toBe(day.start.toISOString());
    expect(same.end.toISOString()).toBe(day.end.toISOString());
  });
});

describe("containsNow — the live signal", () => {
  const opts = { timeZone: BERLIN };
  const day = periodWindow(new Date("2026-05-14T09:00:00Z"), "day", opts);

  it("holds an instant inside the period, and its first instant", () => {
    expect(containsNow(day, day.start)).toBe(true);
    expect(containsNow(day, new Date(day.start.getTime() + 1))).toBe(true);
    expect(containsNow(day, new Date(day.end.getTime() - 1))).toBe(true);
  });

  it("does NOT hold at the exclusive end — that instant is the next period", () => {
    expect(containsNow(day, day.end)).toBe(false);
    expect(containsNow(day, new Date(day.end.getTime() + 1))).toBe(false);
  });

  it("does not hold before the period starts", () => {
    expect(containsNow(day, new Date(day.start.getTime() - 1))).toBe(false);
  });

  it("reads the WINDOW, so a caller holding no grain can spend it", () => {
    // `$lib/statistics/live#includesNow` answers "does the picked range still
    // move?" for windows that are not calendar periods at all — a rolling seven
    // days, an arbitrary custom span. Those have a `[from, to)` and no grain,
    // and the alternative to accepting them here is each caller inventing a
    // filler grain that the predicate then ignores.
    const window: { start: Date; end: Date } = { start: day.start, end: day.end };
    expect(containsNow(window, day.start)).toBe(true);
    expect(containsNow(window, day.end)).toBe(false);
  });
});

describe("canStepForward — standing on the current period IS live", () => {
  const opts = { timeZone: BERLIN };

  it("is false at BOTH the first and the last instant of the current period", () => {
    // The disabled forward arrow is the whole "you are live" signal. An
    // implementation that compares `end` against `now` the wrong way flips this
    // during the last millisecond of the day and the arrow flickers.
    for (const grain of GRAINS) {
      const p = periodWindow(new Date("2026-05-14T09:00:00Z"), grain, opts);
      expect(canStepForward(p, p.start)).toBe(false);
      expect(canStepForward(p, new Date(p.start.getTime() + 1))).toBe(false);
      expect(canStepForward(p, new Date(p.end.getTime() - 1))).toBe(false);
    }
  });

  it("is true the instant the period closes — live has moved on", () => {
    const day = periodWindow(new Date("2026-05-14T09:00:00Z"), "day", opts);
    expect(canStepForward(day, day.end)).toBe(true);
  });

  it("is true for a period in the past", () => {
    const day = periodWindow(new Date("2026-05-14T09:00:00Z"), "day", opts);
    expect(canStepForward(day, new Date("2026-08-17T09:00:00Z"))).toBe(true);
  });

  it("is false for a period entirely ahead of now — there is nothing past live", () => {
    const day = periodWindow(new Date("2026-08-17T09:00:00Z"), "day", opts);
    expect(canStepForward(day, new Date("2026-05-14T09:00:00Z"))).toBe(false);
  });
});

describe("periodOf — which grain a window IS", () => {
  const opts = { timeZone: BERLIN };

  it("names an exact window of each grain", () => {
    for (const grain of GRAINS) {
      const p = periodWindow(new Date("2026-08-17T09:00:00Z"), grain, opts);
      expect(periodOf(p.start, p.end, opts)).toBe(grain);
    }
  });

  it("snaps an exact calendar month to month", () => {
    const from = startOfPeriod(new Date("2026-08-05T09:00:00Z"), "month", opts);
    const to = startOfPeriod(new Date("2026-09-05T09:00:00Z"), "month", opts);
    expect(periodOf(from, to, opts)).toBe("month");
  });

  it("calls a 17-day span custom", () => {
    // The "vs the previous 17 days" comparison on /statistics only exists
    // because arbitrary ranges do; it must not be mistaken for a grain.
    const from = startOfPeriod(new Date("2026-08-01T09:00:00Z"), "day", opts);
    const to = startOfPeriod(new Date("2026-08-18T09:00:00Z"), "day", opts);
    expect(periodOf(from, to, opts)).toBe("custom");
  });

  it("calls a month window nudged off midnight custom", () => {
    const p = periodWindow(new Date("2026-08-17T09:00:00Z"), "month", opts);
    expect(periodOf(new Date(p.start.getTime() + 3_600_000), p.end, opts)).toBe("custom");
    expect(periodOf(p.start, new Date(p.end.getTime() - 1), opts)).toBe("custom");
  });

  it("reads a week against the week start it was asked about", () => {
    const sundayWeek = periodWindow(new Date("2026-05-13T09:00:00Z"), "week", {
      timeZone: BERLIN,
      weekStartsOn: 7,
    });
    expect(periodOf(sundayWeek.start, sundayWeek.end, { timeZone: BERLIN, weekStartsOn: 7 })).toBe(
      "week",
    );
    expect(periodOf(sundayWeek.start, sundayWeek.end, { timeZone: BERLIN })).toBe("custom");
  });

  it("calls an empty or inverted window custom", () => {
    // No guard does this — the grain loop does. Every `periodWindow` is
    // strictly positive in length, so a zero-length or inverted window can
    // never equal one, and the explicit `end <= start` early return that used to
    // sit at the top of `periodOf` was unreachable from any input (replacing it
    // with `if (false)` moved nothing). This case is why deleting it was safe.
    const p = periodWindow(new Date("2026-08-17T09:00:00Z"), "day", opts);
    expect(periodOf(p.start, p.start, opts)).toBe("custom");
    expect(periodOf(p.end, p.start, opts)).toBe("custom");
    // …including a window that starts on a real boundary and ends before it.
    expect(periodOf(p.start, new Date(p.start.getTime() - 1), opts)).toBe("custom");
  });

  it("reads the grain in the zone it is asked in, not the host's", () => {
    // A Berlin month is not a UTC month: the same two instants are a clean
    // month in one zone and a ragged 30-day-and-an-hour window in the other.
    const berlinMonth = periodWindow(new Date("2026-08-17T09:00:00Z"), "month", opts);
    expect(periodOf(berlinMonth.start, berlinMonth.end, { timeZone: "UTC" })).toBe("custom");
  });
});

describe("periodLabel — what the navigator prints", () => {
  const opts = { timeZone: BERLIN, locale: "en-US" };
  const NOW = new Date("2026-08-17T09:00:00Z");

  it("calls the period that contains now Today", () => {
    const day = periodWindow(NOW, "day", opts);
    expect(periodLabel(day, { ...opts, now: NOW })).toBe("Today");
  });

  it("names a past day by its date, and carries the year once it differs", () => {
    const day = periodWindow(new Date("2026-08-02T09:00:00Z"), "day", opts);
    expect(periodLabel(day, { ...opts, now: NOW })).toBe("Aug 2");
    const lastYear = periodWindow(new Date("2025-08-02T09:00:00Z"), "day", opts);
    expect(periodLabel(lastYear, { ...opts, now: NOW })).toBe("Aug 2, 2025");
  });

  it("names a week by the day it starts on", () => {
    const week = periodWindow(NOW, "week", opts);
    expect(periodLabel(week, { ...opts, now: NOW })).toBe("Week of Aug 17");
  });

  it("names a month and a year", () => {
    expect(periodLabel(periodWindow(NOW, "month", opts), { ...opts, now: NOW })).toBe("Aug 2026");
    expect(periodLabel(periodWindow(NOW, "year", opts), { ...opts, now: NOW })).toBe("2026");
  });

  it("reads the calendar from the zone, not from the instant's UTC date", () => {
    // 2027 in UTC, still 2026 in New York — the label must agree with the
    // window, or the reader sees a year they did not select.
    const zoned = { timeZone: "America/New_York", locale: "en-US" };
    const instant = new Date("2027-01-01T02:00:00Z");
    expect(periodLabel(periodWindow(instant, "year", zoned), { ...zoned, now: instant })).toBe(
      "2026",
    );
    expect(periodLabel(periodWindow(instant, "month", zoned), { ...zoned, now: instant })).toBe(
      "Dec 2026",
    );
  });
});

describe("weekStartFor — the locale's own week", () => {
  it("starts the week on Sunday in en-US and on Monday in de-DE", () => {
    expect(weekStartFor("en-US")).toBe(7);
    expect(weekStartFor("de-DE")).toBe(1);
    expect(weekStartFor("fr-FR")).toBe(1);
  });

  it("falls back to Monday when the engine has no getWeekInfo", () => {
    // Missing in some engines and behind a flag in others; reading it unguarded
    // throws on the first render of the picker.
    const proto = Intl.Locale.prototype as { getWeekInfo?: () => { firstDay: number } };
    const real = proto.getWeekInfo;
    delete proto.getWeekInfo;
    try {
      expect(weekStartFor("en-US")).toBe(1);
    } finally {
      if (real) proto.getWeekInfo = real;
    }
  });

  it("falls back to Monday for a tag Intl refuses", () => {
    expect(weekStartFor("not a locale")).toBe(1);
  });
});

describe("switchGrain — which period a grain tab lands on", () => {
  const BERLIN_EN = { timeZone: "Europe/Berlin", locale: "en-US", weekStartsOn: 1 as const };
  // Thursday 14 May 2026, 13:37 Berlin.
  const NOW = new Date("2026-05-14T11:37:00Z");

  it("stays LIVE: from the current period, every tab lands on the one holding now", () => {
    // The reader is standing on live. Switching Month -> Day must not drop them
    // on the 1st of the month — it must keep them live, which is the state the
    // disabled forward arrow is announcing.
    const month = periodWindow(NOW, "month", BERLIN_EN);
    for (const grain of ["day", "week", "month", "year"] as Grain[]) {
      const landed = switchGrain(month, grain, NOW, BERLIN_EN);
      expect(containsNow(landed, NOW)).toBe(true);
      expect(landed.grain).toBe(grain);
    }
  });

  it("keeps a HISTORICAL period anchored at its start", () => {
    // March 2026 -> Day is the 1st of March, not today: the reader navigated
    // away from live on purpose and a grain switch is not a way back.
    const march = periodWindow(new Date("2026-03-17T10:00:00Z"), "month", BERLIN_EN);
    const day = switchGrain(march, "day", NOW, BERLIN_EN);
    expect(wall(day.start, BERLIN_EN.timeZone)).toBe("2026-03-01 00:00");
    expect(wall(day.end, BERLIN_EN.timeZone)).toBe("2026-03-02 00:00");
  });

  it("reads the week from the caller's calendar, not from a fixed Monday", () => {
    const sunday = periodWindow(new Date("2026-03-15T10:00:00Z"), "day", BERLIN_EN);
    const monday = switchGrain(sunday, "week", NOW, BERLIN_EN);
    expect(wall(monday.start, BERLIN_EN.timeZone)).toBe("2026-03-09 00:00");
    const usWeek = switchGrain(sunday, "week", NOW, { ...BERLIN_EN, weekStartsOn: 7 });
    expect(wall(usWeek.start, BERLIN_EN.timeZone)).toBe("2026-03-15 00:00");
  });

  it("canonicalises a period handed in off its own boundary", () => {
    const off = { grain: "month" as const, start: new Date("2026-03-17T10:00:00Z"), end: NOW };
    expect(wall(switchGrain(off, "month", NOW, BERLIN_EN).start, BERLIN_EN.timeZone)).toBe(
      "2026-03-01 00:00",
    );
  });
});

describe("periodTitle — the navigator's header, localized by the caller", () => {
  const MESSAGES = {
    today: () => "Heute",
    weekOf: ({ date }: { date: string }) => `Woche ab ${date}`,
  };
  const OPTS = { timeZone: "Europe/Berlin", locale: "en-US", weekStartsOn: 1 as const };
  const NOW = new Date("2026-05-14T11:37:00Z");

  const title = (instant: Date, grain: Grain, over: Record<string, unknown> = {}) =>
    periodTitle(periodWindow(instant, grain, OPTS), { ...OPTS, now: NOW, ...over }, MESSAGES);

  it("hands the day grain to the caller's own 'today' message", () => {
    // periodLabel bakes the English "Today"; the navigator is a localized
    // surface, so the word has to come from the message catalogue.
    expect(title(NOW, "day")).toBe("Heute");
  });

  it("names any other day by its date", () => {
    expect(title(new Date("2026-05-11T10:00:00Z"), "day")).toBe("May 11");
  });

  it("carries the year once the day is not in the current one", () => {
    expect(title(new Date("2025-08-02T10:00:00Z"), "day")).toBe("Aug 2, 2025");
  });

  it("hands the week grain its start date to interpolate", () => {
    expect(title(NOW, "week")).toBe("Woche ab May 11");
  });

  it("leaves month and year to Intl, which already speaks the locale", () => {
    expect(title(NOW, "month")).toBe("May 2026");
    expect(title(NOW, "year")).toBe("2026");
    expect(title(NOW, "month", { locale: "de-DE" })).toBe("Mai 2026");
  });
});
