import { describe, expect, test } from "bun:test";
import type { DischargeSegment } from "./capacity-estimate";
import {
  BACKFILL_WINDOW_MS,
  ROUTINE_WINDOW_MS,
  interiorSegments,
  planWindows,
  scoreSpan,
  startBatteryScoring,
  type ScoringDeps,
} from "./scoring";

/**
 * The background scorer used to read the WHOLE raw retention window in one
 * query and segment it in one synchronous pass. On an install whose backfill had
 * just carried months of history into `metrics_raw`, that pass never finished:
 * the event loop was gone, `/healthz` stopped answering, and the watchdog
 * restarted the addon every few minutes (seen live 2026-09-09). The pass is now
 * chunked, sequential and overlapping, and these tests pin the shape of that.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

const segment = (startMs: number, endMs: number): DischargeSegment => ({
  startMs,
  endMs,
  socStart: 90,
  socEnd: 20,
  deltaSoc: 70,
  energyKwh: 10,
});

describe("planWindows", () => {
  test("covers the span exactly, in chunks that overlap by the given margin", () => {
    const windows = planWindows(0, 20 * DAY, 7 * DAY, 1 * DAY);
    expect(windows[0]?.from).toBe(0);
    expect(windows.at(-1)?.to).toBe(20 * DAY);
    for (let i = 1; i < windows.length; i++) {
      const prev = windows[i - 1]!;
      const next = windows[i]!;
      // Each chunk starts one overlap before the previous one ended.
      expect(next.from).toBe(prev.to - DAY);
      expect(next.to - next.from).toBeLessThanOrEqual(7 * DAY);
    }
  });

  test("a span shorter than one chunk is one window", () => {
    expect(planWindows(0, 3 * DAY, 7 * DAY, DAY)).toEqual([{ from: 0, to: 3 * DAY }]);
  });

  test("an empty or inverted span plans nothing", () => {
    expect(planWindows(5, 5, DAY, HOUR)).toEqual([]);
    expect(planWindows(9, 5, DAY, HOUR)).toEqual([]);
  });

  test("refuses an overlap that would never advance", () => {
    expect(() => planWindows(0, DAY, DAY, DAY)).toThrow();
  });
});

describe("interiorSegments", () => {
  const span = { from: 0, to: 30 * DAY };
  const window = { from: 7 * DAY, to: 14 * DAY };

  test("keeps a segment well inside the window", () => {
    const s = segment(9 * DAY, 9 * DAY + 8 * HOUR);
    expect(interiorSegments([s], window, span, HOUR)).toEqual([s]);
  });

  test("drops a segment ending against the window's upper edge — it may be cut short", () => {
    // The next, overlapping window sees this discharge whole and records it.
    const s = segment(13 * DAY + 12 * HOUR, 14 * DAY - HOUR / 2);
    expect(interiorSegments([s], window, span, HOUR)).toEqual([]);
  });

  test("drops a segment starting against the window's lower edge — its start may be missing", () => {
    // The previous window covered this one's real start.
    const s = segment(7 * DAY + HOUR / 2, 7 * DAY + 9 * HOUR);
    expect(interiorSegments([s], window, span, HOUR)).toEqual([]);
  });

  test("the span's own edges are real edges, not cuts", () => {
    const first = { from: 0, to: 7 * DAY };
    const last = { from: 23 * DAY, to: 30 * DAY };
    const atStart = segment(0, 8 * HOUR);
    const atEnd = segment(29 * DAY + 20 * HOUR, 30 * DAY - 1);
    expect(interiorSegments([atStart], first, span, HOUR)).toEqual([atStart]);
    expect(interiorSegments([atEnd], last, span, HOUR)).toEqual([atEnd]);
  });
});

/** A deps double that records every window it was asked for and how many overlapped. */
function fakeDeps(opts: { fail?: (from: Date) => boolean; segmentsPer?: number } = {}) {
  const asked: Array<{ from: number; to: number }> = [];
  const recorded: DischargeSegment[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const deps: ScoringDeps = {
    async measure(from, to) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      asked.push({ from: from.getTime(), to: to.getTime() });
      if (opts.fail?.(from)) throw new Error("boom");
      const n = opts.segmentsPer ?? 1;
      const mid = from.getTime() + (to.getTime() - from.getTime()) / 2;
      return Array.from({ length: n }, (_, i) => segment(mid + i * HOUR, mid + (i + 1) * HOUR));
    },
    async record(segments) {
      recorded.push([...segments]);
      return segments.length;
    },
  };
  return { deps, asked, recorded, maxInFlight: () => maxInFlight };
}

describe("scoreSpan", () => {
  test("walks the chunks ONE AT A TIME — never all queries in flight at once", async () => {
    const { deps, asked, maxInFlight } = fakeDeps();
    const now = 100 * DAY;
    await scoreSpan(deps, now - 30 * DAY, now, { chunkMs: 7 * DAY, overlapMs: DAY, marginMs: HOUR });
    expect(asked.length).toBeGreaterThan(3);
    expect(maxInFlight()).toBe(1);
    expect(asked[0]?.from).toBe(now - 30 * DAY);
    expect(asked.at(-1)?.to).toBe(now);
  });

  test("a chunk that fails is skipped and the rest are still scored", async () => {
    const log: string[] = [];
    const { deps, asked } = fakeDeps({ fail: (from) => from.getTime() === 6 * DAY });
    const result = await scoreSpan(
      { ...deps, log: (m) => log.push(m) },
      0,
      20 * DAY,
      { chunkMs: 7 * DAY, overlapMs: DAY, marginMs: HOUR },
    );
    expect(asked.map((w) => w.from)).toEqual([0, 6 * DAY, 12 * DAY, 18 * DAY]);
    expect(result.measured).toBe(3);
    expect(log.some((m) => /boom/.test(m))).toBe(true);
  });

  test("sums what was measured and what was actually stored", async () => {
    const { deps } = fakeDeps({ segmentsPer: 2 });
    const result = await scoreSpan(deps, 0, 7 * DAY, { chunkMs: 7 * DAY, overlapMs: DAY, marginMs: HOUR });
    expect(result).toEqual({ measured: 2, stored: 2 });
  });
});

describe("startBatteryScoring", () => {
  const profile = {
    id: "p",
    name: "P",
    metrics: [
      { key: "battery.soc", role: "battery.soc" },
      { key: "battery.power", role: "battery.power" },
    ],
  } as unknown as Parameters<typeof startBatteryScoring>[0];

  test("the first pass is the whole retention window, chunked, and it yields between chunks", async () => {
    const { deps, asked, maxInFlight } = fakeDeps();
    const now = new Date(1_800 * DAY);
    const done = new Promise<void>((resolve) => {
      const stop = startBatteryScoring(profile, () => {}, {
        ...deps,
        now: () => now,
        onPass: (label) => {
          if (label === "backfill") {
            stop();
            resolve();
          }
        },
      });
    });
    await done;
    expect(asked[0]?.from).toBe(now.getTime() - BACKFILL_WINDOW_MS);
    expect(asked.at(-1)?.to).toBe(now.getTime());
    // Hundreds of chunks, not one query for five years.
    expect(asked.length).toBeGreaterThan(100);
    for (const w of asked) expect(w.to - w.from).toBeLessThanOrEqual(7 * DAY);
    expect(maxInFlight()).toBe(1);
  });

  test("a profile without SOC or power schedules nothing", () => {
    const { deps, asked } = fakeDeps();
    const stop = startBatteryScoring(
      { id: "x", name: "X", metrics: [] } as unknown as Parameters<typeof startBatteryScoring>[0],
      () => {},
      deps,
    );
    stop();
    expect(asked).toEqual([]);
  });

  test("a routine pass is a short trailing window, one chunk", () => {
    expect(ROUTINE_WINDOW_MS).toBeLessThanOrEqual(7 * DAY);
  });
});
