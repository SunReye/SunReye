import { describe, expect, test } from "bun:test";
import type { ComparisonResponse } from "@SunReye/contracts/statistics";
import {
  baselineLabel,
  deltaFor,
  formatDelta,
  pricedWindow,
  referenceWindow,
  usableComparison,
  windowDays,
} from "./compare";

describe("deltaFor", () => {
  test("signs the relative change", () => {
    expect(deltaFor(110, 100)).toBeCloseTo(0.1);
    expect(deltaFor(90, 100)).toBeCloseTo(-0.1);
    expect(deltaFor(100, 100)).toBe(0);
  });

  test("measures against the magnitude of a negative reference", () => {
    // Dividing by |previous| keeps the sign meaning "moved down" even when the
    // reference is negative: −20 after −10 is a further −100%, and the tile's
    // goodDirection decides whether down is good news.
    expect(deltaFor(-20, -10)).toBeCloseTo(-1);
    expect(deltaFor(-5, -10)).toBeCloseTo(0.5);
  });

  test("has no answer without a usable reference", () => {
    expect(deltaFor(10, 0)).toBeNull();
    expect(deltaFor(10, null)).toBeNull();
    expect(deltaFor(null, 10)).toBeNull();
    expect(deltaFor(Number.NaN, 10)).toBeNull();
  });
});

describe("formatDelta", () => {
  test("carries the sign in the arrow and the size in whole percent", () => {
    expect(formatDelta(0.1234)).toBe("▲ 12%");
    expect(formatDelta(-0.1234)).toBe("▼ 12%");
  });

  test("states the magnitude unsigned — the arrow already said which way", () => {
    expect(formatDelta(-0.4)).toBe("▼ 40%");
    expect(formatDelta(0.4)).toBe("▲ 40%");
  });

  test("reads an unchanged window as 0%", () => {
    // The chip greys a rounded-to-zero move out rather than colouring it, so
    // the arrow the text carries here is not read as a direction.
    expect(formatDelta(0)).toBe("▼ 0%");
    expect(formatDelta(0.004)).toBe("▲ 0%");
  });

  test("caps a near-zero baseline instead of printing +11 780 %", () => {
    expect(formatDelta(9.99)).toBe("▲ 999%");
    expect(formatDelta(10)).toBe("▲ >999%");
    expect(formatDelta(-42)).toBe("▼ >999%");
  });

  test("renders an em-dash when there is no usable reference", () => {
    expect(formatDelta(null)).toBe("—");
  });
});

describe("baselineLabel", () => {
  test("names the adjacent window in days", () => {
    expect(baselineLabel("previous", 7)).toBe("the previous 7 days");
    expect(baselineLabel("previous", 31)).toBe("the previous 31 days");
  });

  test("calls a one-day reference yesterday", () => {
    expect(baselineLabel("previous", 1)).toBe("yesterday");
  });

  test("names the calendar comparison, whatever the window length", () => {
    expect(baselineLabel("yearAgo", 1)).toBe("the same period a year ago");
    expect(baselineLabel("yearAgo", 365)).toBe("the same period a year ago");
  });
});

describe("referenceWindow", () => {
  test("previous is the adjacent same-length window", () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-08T00:00:00.000Z");
    const ref = referenceWindow(from, to, "previous");
    expect(ref.from.toISOString()).toBe("2026-06-24T00:00:00.000Z");
    expect(ref.to.toISOString()).toBe(from.toISOString());
  });

  test("yearAgo shifts the calendar window back one year", () => {
    const from = new Date(2026, 6, 1);
    const to = new Date(2026, 7, 1);
    const ref = referenceWindow(from, to, "yearAgo");
    expect(ref.from.getFullYear()).toBe(2025);
    expect(ref.from.getMonth()).toBe(6);
    expect(ref.to.getFullYear()).toBe(2025);
  });

  test("previous keeps the length of a window that starts mid-day", () => {
    // The range picker hands over local midnights, but a "last 24 h" style
    // window can start at any hour — the reference has to be the same length,
    // not the same calendar day.
    const from = new Date(2026, 6, 3, 14, 30);
    const to = new Date(2026, 6, 4, 6, 15);
    const ref = referenceWindow(from, to, "previous");
    expect(ref.to.getTime()).toBe(from.getTime());
    expect(ref.to.getTime() - ref.from.getTime()).toBe(to.getTime() - from.getTime());
    expect(ref.from.getHours()).toBe(22);
  });

  test("previous of a single day is the day before it", () => {
    const from = new Date(2026, 6, 3);
    const to = new Date(2026, 6, 4);
    const ref = referenceWindow(from, to, "previous");
    expect(ref.from.getDate()).toBe(2);
    expect(ref.to.getDate()).toBe(3);
  });

  test("leaves the picked range untouched", () => {
    // Both branches build new Dates; shifting the caller's own range in place
    // would move the window the page is showing.
    const from = new Date(2026, 6, 1);
    const to = new Date(2026, 7, 1);
    referenceWindow(from, to, "yearAgo");
    referenceWindow(from, to, "previous");
    expect(from.getFullYear()).toBe(2026);
    expect(to.getFullYear()).toBe(2026);
  });

  test("a leap day a year back lands on March 1, exactly as the server prices it", () => {
    // Mirrors `previousWindow` in statistics-calc.ts: 2024-02-29 has no 2023
    // counterpart, so the shift rolls into March. What matters is that both
    // sides roll the same way — the client's coverage check must be testing the
    // window the server actually compared against.
    const ref = referenceWindow(new Date(2024, 1, 29), new Date(2024, 2, 1), "yearAgo");
    expect(ref.from.getFullYear()).toBe(2023);
    expect(ref.from.getMonth()).toBe(2);
    expect(ref.from.getDate()).toBe(1);
  });
});

describe("usableComparison", () => {
  const reference = { from: new Date("2026-06-01T00:00:00.000Z") };
  const payload = (dataFrom: string | null) =>
    ({
      mode: "previous",
      current: { net: 20 },
      previous: { net: 30 },
      coverage: { dataFrom },
    }) as unknown as ComparisonResponse;

  test("keeps the reference once history starts at or before it", () => {
    expect(usableComparison(payload("2026-05-01T00:00:00.000Z"), reference).previous).toMatchObject(
      { net: 30 },
    );
    expect(
      usableComparison(payload("2026-06-01T00:00:00.000Z"), reference).previous,
    ).not.toBeNull();
  });

  test("drops a reference window that predates recorded history", () => {
    expect(usableComparison(payload("2026-06-15T00:00:00.000Z"), reference)).toMatchObject({
      current: { net: 20 },
      previous: null,
    });
    expect(usableComparison(payload(null), reference).previous).toBeNull();
  });

  test("has nothing at all without a payload", () => {
    expect(usableComparison(null, reference)).toEqual({ current: null, previous: null });
  });

  test("drops the reference when history starts a single millisecond too late", () => {
    expect(usableComparison(payload("2026-06-01T00:00:00.001Z"), reference).previous).toBeNull();
  });

  test("keeps the current window even when the reference is unusable", () => {
    // The window the reader picked is real data; only the chips go away.
    expect(usableComparison(payload(null), reference).current).toMatchObject({ net: 20 });
  });

  test("suppresses the chips on an unreadable history start", () => {
    expect(usableComparison(payload("not-a-date"), reference).previous).toBeNull();
  });
});

describe("windowDays", () => {
  test("counts whole days, never below one", () => {
    expect(windowDays(new Date(2026, 6, 1), new Date(2026, 7, 1))).toBe(31);
    expect(windowDays(new Date(2026, 6, 1), new Date(2026, 6, 1, 6))).toBe(1);
  });

  test("counts a 23-hour clock-change day as one day", () => {
    // The caption reads "vs previous {n} days"; a spring-forward day losing an
    // hour must not turn a week into six days.
    const from = new Date(2026, 2, 29);
    expect(windowDays(from, new Date(from.getTime() + 23 * 3_600_000))).toBe(1);
    expect(windowDays(from, new Date(from.getTime() + 7 * 86_400_000 - 3_600_000))).toBe(7);
  });

  test("gives one answer all day — the caption does not change baseline over lunch", () => {
    // THE NOON FLIP. `Math.round(span / 86_400_000)` over a window clamped at
    // `now` (which is what `pricedWindow` hands this for the period the reader
    // is standing in) reads "vs the previous 20 days" before midday and "21
    // days" after it — same window, same data, same server comparison, a
    // caption that re-bases itself while the reader watches. Counted in CIVIL
    // DAYS the answer is how many days the window touches, which holds still
    // for a whole day.
    const from = new Date(2026, 7, 1);
    const morning = windowDays(from, new Date(2026, 7, 21, 3, 0));
    const afternoon = windowDays(from, new Date(2026, 7, 21, 15, 0));
    expect(morning).toBe(afternoon);
    expect(morning).toBe(21);
  });

  test("counts the rolling seven days as seven, at any hour of the day", () => {
    // What `$lib/cost/ranges#rollingWeek` already claims in prose: "Last 7 days"
    // is 7. The comparison prices the part of the window that has happened, so
    // at 01:00 that is six days and an hour — which rounded to six, and the
    // reader who picked "Last 7 days" was told their deltas were measured
    // against the previous SIX.
    const from = new Date(2026, 7, 15);
    expect(windowDays(from, new Date(2026, 7, 21, 1, 0))).toBe(7);
    expect(windowDays(from, new Date(2026, 7, 21, 12, 30))).toBe(7);
    expect(windowDays(from, new Date(2026, 7, 21, 23, 59))).toBe(7);
  });

  test("never reports zero or a negative caption for an empty or inverted range", () => {
    const day = new Date(2026, 6, 1);
    expect(windowDays(day, day)).toBe(1);
    expect(windowDays(new Date(2026, 7, 1), new Date(2026, 6, 1))).toBe(1);
  });
});

describe("pricedWindow", () => {
  const now = new Date(2026, 7, 2, 19, 30);

  test("clamps a period that runs into the future back to now", () => {
    // A calendar period's `to` is its exclusive end, which for the CURRENT
    // period is in the future — deliberately, so the detail chart has a settled
    // axis. The comparison cannot use it: the server has data for August up to
    // now and a full 31 days for July, so an unclamped window prices twenty days
    // against thirty-one and every delta reads as a collapse.
    const august = pricedWindow({ from: new Date(2026, 7, 1), to: new Date(2026, 8, 1) }, now);
    expect(august.from).toEqual(new Date(2026, 7, 1));
    expect(august.to).toBe(now);
  });

  test("leaves a closed window exactly where it is", () => {
    const july = { from: new Date(2026, 6, 1), to: new Date(2026, 7, 1) };
    expect(pricedWindow(july, now)).toEqual(july);
  });

  test("keeps the reference window length-matched to what was actually priced", () => {
    // The two have to be derived from the SAME window or the comparison is
    // between windows of different lengths — which is the bug above, one layer
    // down.
    const priced = pricedWindow({ from: new Date(2026, 7, 1), to: new Date(2026, 8, 1) }, now);
    const reference = referenceWindow(priced.from, priced.to, "previous");
    expect(windowDays(reference.from, reference.to)).toBe(windowDays(priced.from, priced.to));
  });

  test("does not invert a window that has not started yet", () => {
    // A custom range picked entirely in the future would otherwise come back
    // with `to` before `from`, and `referenceWindow` would hand the server a
    // negative-length reference.
    const future = { from: new Date(2026, 7, 10), to: new Date(2026, 7, 12) };
    expect(pricedWindow(future, now)).toEqual(future);
  });
});
