/**
 * THE EXPORT PLAN, without a database.
 *
 * One property is load-bearing above all others and it is the reason this file
 * exists: a given (device, metric, instant) must appear in the archive EXACTLY
 * ONCE. An hourly bucket and the sixty minute buckets inside it are the same
 * energy counted twice, so a plan that overlaps is not a slow export — it is a
 * wrong one, and the wrongness only shows up as a kWh figure nobody can explain
 * months later.
 *
 * The second property is that no covered day is silently dropped: a gap is
 * reported, and a gap that was reported can be investigated.
 */
import { describe, expect, test } from "bun:test";

import {
  type SourceWindow,
  WINDOW_DAYS,
  createChangeFilter,
  planExport,
  windowsOf,
} from "./archive-export";
import type { SourceTier } from "./archive";

const at = (iso: string) => new Date(iso);

const window = (tier: SourceTier, from: string, to: string): SourceWindow => ({
  tier,
  from: at(from),
  to: at(to),
});

/** Total milliseconds a plan claims to cover, and the days it names twice. */
function coverage(chunks: readonly { start: Date; end: Date }[]) {
  const sorted = [...chunks].sort((a, b) => a.start.getTime() - b.start.getTime());
  let covered = 0;
  const overlaps: string[] = [];
  let previousEnd = -Infinity;
  for (const chunk of sorted) {
    covered += chunk.end.getTime() - chunk.start.getTime();
    if (chunk.start.getTime() < previousEnd) {
      overlaps.push(
        `${chunk.start.toISOString()} starts before ${new Date(previousEnd).toISOString()}`,
      );
    }
    previousEnd = Math.max(previousEnd, chunk.end.getTime());
  }
  return { covered, overlaps };
}

describe("planExport", () => {
  test("raw wins every day it covers — it is the finest source there is", () => {
    const plan = planExport(
      [
        window("raw", "2026-08-20T00:00:00Z", "2026-08-27T00:00:00Z"),
        window("minute", "2026-08-20T00:00:00Z", "2026-08-27T00:00:00Z"),
      ],
      { from: at("2026-08-20T00:00:00Z"), to: at("2026-08-27T00:00:00Z") },
    );
    expect(plan.chunks).toHaveLength(7);
    expect(new Set(plan.chunks.map((c) => c.tier))).toEqual(new Set(["raw"]));
  });

  test("THE REAL FIXTURE'S SHAPE: minute for the old span, raw for the retained week", () => {
    // 1.2.0 keeps raw for 7 days and minute buckets for 90, so a 60-day history
    // is a union of two sources. This is the case `source_tier` exists for.
    const plan = planExport(
      [
        window("raw", "2026-08-20T00:00:00Z", "2026-08-27T00:00:00Z"),
        window("minute", "2026-06-28T00:00:00Z", "2026-08-27T00:00:00Z"),
        window("hourly", "2026-06-28T00:00:00Z", "2026-08-27T00:00:00Z"),
        window("daily", "2026-06-28T00:00:00Z", "2026-08-27T00:00:00Z"),
      ],
      { from: at("2026-06-28T00:00:00Z"), to: at("2026-08-27T00:00:00Z") },
    );
    const byTier = plan.chunks.reduce<Record<string, number>>((acc, chunk) => {
      acc[chunk.tier] = (acc[chunk.tier] ?? 0) + 1;
      return acc;
    }, {});
    expect(byTier).toEqual({ minute: 53, raw: 7 });
    expect(plan.gaps).toEqual([]);
  });

  test("no day is ever claimed by two sources", () => {
    const plan = planExport(
      [
        window("raw", "2026-08-20T00:00:00Z", "2026-08-27T00:00:00Z"),
        window("minute", "2026-07-28T00:00:00Z", "2026-08-27T00:00:00Z"),
        window("hourly", "2026-06-28T00:00:00Z", "2026-08-27T00:00:00Z"),
      ],
      { from: at("2026-06-28T00:00:00Z"), to: at("2026-08-27T00:00:00Z") },
    );
    const { covered, overlaps } = coverage(plan.chunks);
    expect(overlaps).toEqual([]);
    // 60 days, each claimed once and only once.
    expect(covered).toBe(60 * 86_400_000);
  });

  test("a coarser tier answers a day the finer ones have aged out of", () => {
    const plan = planExport(
      [
        window("minute", "2026-08-25T00:00:00Z", "2026-08-27T00:00:00Z"),
        window("daily", "2026-08-20T00:00:00Z", "2026-08-27T00:00:00Z"),
      ],
      { from: at("2026-08-20T00:00:00Z"), to: at("2026-08-27T00:00:00Z") },
    );
    expect(plan.chunks.filter((c) => c.tier === "daily")).toHaveLength(5);
    expect(plan.chunks.filter((c) => c.tier === "minute")).toHaveLength(2);
  });

  test("a day no source covers is a REPORTED gap, never a silent skip", () => {
    const plan = planExport([window("minute", "2026-08-25T00:00:00Z", "2026-08-27T00:00:00Z")], {
      from: at("2026-08-20T00:00:00Z"),
      to: at("2026-08-27T00:00:00Z"),
    });
    expect(plan.chunks).toHaveLength(2);
    expect(plan.gaps).toHaveLength(5);
    expect(plan.gaps[0]?.start.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  test("THE NEWEST DAY is answered by raw even though raw stops mid-day", () => {
    // The bug this pins: raw's window ends at its last row, so the CURRENT day is
    // always "partially covered" — and requiring coverage to midnight handed that
    // day to the minute tier instead. On a 2.0.0 database whose minute buckets each
    // hold one sample, `average(tw)` is NULL for every one of them (a point has no
    // duration), so those rows were dropped and a whole day vanished from the
    // export: 8,920,800 rows instead of 9,072,000, with nothing reported.
    const plan = planExport(
      [
        window("raw", "2026-08-20T00:00:00Z", "2026-08-26T23:59:00.001Z"),
        window("minute", "2026-08-20T00:00:00Z", "2026-08-27T00:00:00Z"),
      ],
      { from: at("2026-08-20T00:00:00Z"), to: at("2026-08-27T00:00:00Z") },
    );
    expect(plan.chunks.filter((c) => c.tier === "raw")).toHaveLength(7);
    expect(plan.chunks.filter((c) => c.tier === "minute")).toHaveLength(0);
  });

  test("a raw window that STARTS mid-day leaves that day to a bucket tier", () => {
    // The other edge, and it must NOT be treated the same way. 1.2.0 trims raw to
    // seven days, so on the oldest raw day raw holds only the afternoon while the
    // minute tier holds the whole day. Preferring raw there would silently lose the
    // morning.
    const plan = planExport(
      [
        window("raw", "2026-08-20T12:00:00Z", "2026-08-27T00:00:00Z"),
        window("minute", "2026-08-01T00:00:00Z", "2026-08-27T00:00:00Z"),
      ],
      { from: at("2026-08-20T00:00:00Z"), to: at("2026-08-22T00:00:00Z") },
    );
    expect(plan.chunks[0]).toEqual({
      tier: "minute",
      start: at("2026-08-20T00:00:00Z"),
      end: at("2026-08-21T00:00:00Z"),
    });
    expect(plan.chunks[1]?.tier).toBe("raw");
  });

  test("a day raw does not reach at all is left to a bucket tier", () => {
    const plan = planExport(
      [
        window("raw", "2026-08-25T00:00:00Z", "2026-08-27T00:00:00Z"),
        window("minute", "2026-08-20T00:00:00Z", "2026-08-27T00:00:00Z"),
      ],
      { from: at("2026-08-20T00:00:00Z"), to: at("2026-08-27T00:00:00Z") },
    );
    expect(plan.chunks.filter((c) => c.tier === "minute")).toHaveLength(5);
    expect(plan.chunks.filter((c) => c.tier === "raw")).toHaveLength(2);
  });

  test("a raw window covering only PART of a day does not claim that day", () => {
    // Half a day of raw is not a day of raw. Claiming it would leave the other
    // half unwritten — worse than using a coarser tier for all of it.
    const plan = planExport(
      [
        window("raw", "2026-08-20T12:00:00Z", "2026-08-21T00:00:00Z"),
        window("minute", "2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z"),
      ],
      { from: at("2026-08-20T00:00:00Z"), to: at("2026-08-21T00:00:00Z") },
    );
    expect(plan.chunks).toEqual([
      { tier: "minute", start: at("2026-08-20T00:00:00Z"), end: at("2026-08-21T00:00:00Z") },
    ]);
  });

  test("a partial first and last day keep the caller's own bounds", () => {
    // The same rule `planReplay` follows: the outer bounds are the caller's, not
    // rounded out to whole days. Rounding outwards would double-write the overlap
    // with whatever wrote the neighbouring day.
    const plan = planExport([window("raw", "2026-08-20T06:00:00Z", "2026-08-21T18:00:00Z")], {
      from: at("2026-08-20T06:00:00Z"),
      to: at("2026-08-21T18:00:00Z"),
    });
    expect(plan.chunks).toEqual([
      { tier: "raw", start: at("2026-08-20T06:00:00Z"), end: at("2026-08-21T00:00:00Z") },
      { tier: "raw", start: at("2026-08-21T00:00:00Z"), end: at("2026-08-21T18:00:00Z") },
    ]);
    expect(plan.gaps).toEqual([]);
    // Still tiled exactly: the day split is at the UTC boundary, nowhere else.
    const { covered, overlaps } = coverage(plan.chunks);
    expect(overlaps).toEqual([]);
    expect(covered).toBe(36 * 3_600_000);
  });

  test("no windows at all is an empty plan, not a crash", () => {
    const plan = planExport([], {
      from: at("2026-08-20T00:00:00Z"),
      to: at("2026-08-21T00:00:00Z"),
    });
    expect(plan.chunks).toEqual([]);
    expect(plan.gaps).toHaveLength(1);
  });

  test("a zero-length span plans nothing", () => {
    const plan = planExport([window("raw", "2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z")], {
      from: at("2026-08-20T00:00:00Z"),
      to: at("2026-08-20T00:00:00Z"),
    });
    expect(plan.chunks).toEqual([]);
    expect(plan.gaps).toEqual([]);
  });

  test("a single day of history is one chunk", () => {
    const plan = planExport([window("daily", "2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z")], {
      from: at("2026-08-20T00:00:00Z"),
      to: at("2026-08-21T00:00:00Z"),
    });
    expect(plan.chunks).toEqual([
      { tier: "daily", start: at("2026-08-20T00:00:00Z"), end: at("2026-08-21T00:00:00Z") },
    ]);
  });
});

describe("windowsOf", () => {
  test("a chunk shorter than the window is one window", () => {
    expect(
      windowsOf({ start: at("2026-08-20T00:00:00Z"), end: at("2026-08-21T00:00:00Z") }, 30),
    ).toHaveLength(1);
  });

  test("a long chunk is split at the window size", () => {
    const windows = windowsOf(
      { start: at("2026-06-28T00:00:00Z"), end: at("2026-08-27T00:00:00Z") },
      30,
    );
    expect(windows).toHaveLength(2);
    expect(windows[0]?.end.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(windows.at(-1)?.end.toISOString()).toBe("2026-08-27T00:00:00.000Z");
  });

  test("the windows tile the chunk exactly — no gap and no overlap", () => {
    const chunk = { start: at("2026-06-28T00:00:00Z"), end: at("2026-08-27T13:00:00Z") };
    const windows = windowsOf(chunk, 7);
    const { covered, overlaps } = coverage(windows);
    expect(overlaps).toEqual([]);
    expect(covered).toBe(chunk.end.getTime() - chunk.start.getTime());
    expect(windows[0]?.start).toEqual(chunk.start);
    expect(windows.at(-1)?.end).toEqual(chunk.end);
  });

  test("an empty chunk yields no windows", () => {
    const now = at("2026-08-20T00:00:00Z");
    expect(windowsOf({ start: now, end: now }, 1)).toEqual([]);
  });

  test("every tier has a window size, finest getting the smallest", () => {
    expect(WINDOW_DAYS.raw).toBeLessThan(WINDOW_DAYS.minute);
    expect(WINDOW_DAYS.minute).toBeLessThan(WINDOW_DAYS.hourly);
    expect(WINDOW_DAYS.hourly).toBeLessThan(WINDOW_DAYS.daily);
  });
});

describe("createChangeFilter", () => {
  test("the first value of a series is always a change", () => {
    const changed = createChangeFilter();
    expect(changed("a", 42)).toBe(true);
  });

  test("a repeated value is not a change — that is the whole collapse", () => {
    const changed = createChangeFilter();
    expect(changed("a", 42)).toBe(true);
    expect(changed("a", 42)).toBe(false);
    expect(changed("a", 42)).toBe(false);
  });

  test("a change back to a previous value IS a change", () => {
    const changed = createChangeFilter();
    changed("a", 1);
    changed("a", 2);
    expect(changed("a", 1)).toBe(true);
  });

  test("ZERO is a value: the first zero is a change and the second is not", () => {
    // A falsy check here would emit every zero forever, which is the most common
    // setting value there is (a disabled limit).
    const changed = createChangeFilter();
    expect(changed("a", 0)).toBe(true);
    expect(changed("a", 0)).toBe(false);
    expect(changed("a", -0)).toBe(false);
  });

  test("a negative value is tracked like any other", () => {
    const changed = createChangeFilter();
    expect(changed("a", -5)).toBe(true);
    expect(changed("a", -5)).toBe(false);
    expect(changed("a", 5)).toBe(true);
  });

  test("series are independent — one metric's value never masks another's", () => {
    const changed = createChangeFilter();
    expect(changed("a", 1)).toBe(true);
    expect(changed("b", 1)).toBe(true);
    expect(changed("a", 1)).toBe(false);
  });
});
