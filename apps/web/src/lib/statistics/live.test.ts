import { describe, expect, test } from "bun:test";
import { costRangeFor, customCostRange, resolveCostPreset } from "$lib/cost/ranges";
import { browserTimeZone } from "$lib/time/browser-zone";
import { periodWindow, stepPeriod, type Grain } from "$lib/time/period";
import { includesNow, liveModeFor, shouldRevalidate } from "./live";

/** The module's default floor between two live-triggered refetches. */
const MINUTE = 60_000;

const NOW = new Date("2026-08-02T10:30:00");
const OPTS = { timeZone: browserTimeZone() };

/** The range a navigator tab produces for the period holding `NOW`. */
const current = (grain: Grain) => costRangeFor(periodWindow(NOW, grain, OPTS), NOW);
/** …and the same tab one back-press earlier. */
const previous = (grain: Grain) =>
  costRangeFor(stepPeriod(periodWindow(NOW, grain, OPTS), -1, OPTS), NOW);

const GRAINS = ["day", "week", "month", "year"] as const;

describe("includesNow", () => {
  test("holds for all four grains standing on the current period", () => {
    // The four now-inclusive cases. They used to be an id set — "today", "7d",
    // "month", "year" — and the set is gone: a period range carries a `to` in
    // the future, so the window itself answers.
    for (const grain of GRAINS) expect(includesNow(current(grain), NOW)).toBe(true);
  });

  test("and for the one kept preset, whose window runs to the end of today", () => {
    expect(includesNow(resolveCostPreset("7d", NOW), NOW)).toBe(true);
  });

  test("stays true as the clock moves through the period", () => {
    // The lease must not drop a tick after the range was resolved. This is what
    // the id set was papering over for the windows that clamped `to` at `now`.
    const later = new Date(NOW.getTime() + 10 * MINUTE);
    for (const grain of GRAINS) expect(includesNow(current(grain), later)).toBe(true);
  });

  test("is FALSE one back-press earlier, at every grain", () => {
    // The id-set version answered by id, so a stepped-back Month was still
    // "month" and still leased the feed — the server's periodic job then ran
    // for a window that can never change again.
    for (const grain of GRAINS) expect(includesNow(previous(grain), NOW)).toBe(false);
  });

  test("does not hold at the exclusive end of a closed window", () => {
    const yesterday = previous("day");
    expect(includesNow(yesterday, yesterday.to)).toBe(false);
    expect(includesNow(yesterday, new Date(yesterday.to.getTime() - 1))).toBe(true);
  });

  test("follows the end boundary of a custom range", () => {
    // Ends today: the exclusive boundary is tomorrow's midnight, so it moves.
    const upToToday = customCostRange(new Date(2026, 6, 1), new Date(2026, 7, 2), NOW);
    expect(includesNow(upToToday, NOW)).toBe(true);
    const historical = customCostRange(new Date(2026, 5, 1), new Date(2026, 5, 30), NOW);
    expect(includesNow(historical, NOW)).toBe(false);
  });

  test("is false for a window that has not started yet", () => {
    // `range.to > now` alone said yes to this. A custom range picked entirely in
    // the future has nothing to stream, and the calendar does not stop you.
    const future = customCostRange(new Date(2026, 7, 10), new Date(2026, 7, 12), NOW);
    expect(includesNow(future, NOW)).toBe(false);
  });
});

describe("liveModeFor", () => {
  test("patches the tiles from the payload only on the day holding now", () => {
    expect(liveModeFor(current("day"), NOW)).toBe("today");
    expect(liveModeFor(current("week"), NOW)).toBe("window");
    expect(liveModeFor(current("year"), NOW)).toBe("window");
    expect(liveModeFor(resolveCostPreset("7d", NOW), NOW)).toBe("window");
  });

  test("a PAST day is a window, not today", () => {
    // The stream's `today` payload is today's breakdown. Handing it to a range
    // showing last Tuesday would overwrite that day's totals with this one's.
    expect(liveModeFor(previous("day"), NOW)).toBe("window");
  });
});

describe("shouldRevalidate", () => {
  const now = 1_000_000;

  test("allows the first revalidation", () => {
    expect(shouldRevalidate(null, now)).toBe(true);
  });

  test("holds pushes inside the default one-minute window", () => {
    expect(shouldRevalidate(now - (MINUTE - 1), now)).toBe(false);
    expect(shouldRevalidate(now, now)).toBe(false);
  });

  test("lets a push through once the floor has passed", () => {
    expect(shouldRevalidate(now - MINUTE, now)).toBe(true);
    expect(shouldRevalidate(now - 10 * MINUTE, now)).toBe(true);
  });

  test("takes a custom floor", () => {
    expect(shouldRevalidate(now - 5_000, now, 1_000)).toBe(true);
    expect(shouldRevalidate(now - 500, now, 1_000)).toBe(false);
  });
});
