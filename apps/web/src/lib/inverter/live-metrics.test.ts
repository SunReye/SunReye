import { describe, expect, test } from "bun:test";
import {
  backfillSeconds,
  isFullBackfill,
  LiveSeries,
  MAX_POINTS,
  MetricsFeed,
  type RecentBackfill,
  WINDOW_MS,
} from "./live-metrics";
import type { LivePoint, LiveSample } from "./types";

/** Build a compact backfill payload the way the endpoint encodes one. */
function payload(
  t0: number,
  metrics: Record<string, { o: number[]; v: number[] }>,
  step = 1,
): RecentBackfill {
  return { t0, step, metrics };
}

/** One metric's payload, written as absolute ms/value pairs for readability. */
function series(t0: number, points: Array<[number, number]>, step = 1) {
  return {
    o: points.map(([t]) => (t - t0) / (step * 1000)),
    v: points.map(([, v]) => v),
  };
}

/** Plain-Map stand-in for the store's `SvelteMap` — the sink is injected, so no runes here. */
function sink(): Map<string, LivePoint[]> {
  return new Map<string, LivePoint[]>();
}

function sample(time: number, metrics: Record<string, number>): LiveSample {
  return { time: new Date(time).toISOString(), inverterId: "inv", metrics };
}

describe("LiveSeries.appendSample", () => {
  test("keeps one buffer per metric, in arrival order", () => {
    const map = sink();
    const series = new LiveSeries(map);
    series.appendSample(sample(1000, { pv: 10, load: 5 }));
    series.appendSample(sample(2000, { pv: 20, load: 6 }));
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 10 },
      { t: 2000, v: 20 },
    ]);
    expect(map.get("load")).toEqual([
      { t: 1000, v: 5 },
      { t: 2000, v: 6 },
    ]);
  });

  test("zero and negative values are samples, not absent readings", () => {
    const map = sink();
    const series = new LiveSeries(map);
    series.appendSample(sample(1000, { grid: 0 }));
    series.appendSample(sample(2000, { grid: -350 }));
    expect(map.get("grid")).toEqual([
      { t: 1000, v: 0 },
      { t: 2000, v: -350 },
    ]);
  });

  test("writes a new array each tick so a consumer re-renders", () => {
    const map = sink();
    const series = new LiveSeries(map);
    series.appendSample(sample(1000, { pv: 1 }));
    const first = map.get("pv");
    series.appendSample(sample(2000, { pv: 2 }));
    expect(map.get("pv")).not.toBe(first);
  });

  test("drops points that fell out of the trailing window", () => {
    const map = sink();
    const series = new LiveSeries(map);
    series.appendSample(sample(1000, { pv: 1 }));
    series.appendSample(sample(1000 + WINDOW_MS, { pv: 2 }));
    // The point exactly at the cutoff is still inside the window.
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 1 },
      { t: 1000 + WINDOW_MS, v: 2 },
    ]);
    series.appendSample(sample(1001 + WINDOW_MS, { pv: 3 }));
    expect(map.get("pv")).toEqual([
      { t: 1000 + WINDOW_MS, v: 2 },
      { t: 1001 + WINDOW_MS, v: 3 },
    ]);
  });

  test("a feed faster than 1 Hz is capped instead of growing unbounded", () => {
    const map = sink();
    const series = new LiveSeries(map);
    // All inside the window, so only the hard cap can bound this.
    for (let i = 0; i < MAX_POINTS + 50; i++) series.appendSample(sample(1000 + i, { pv: i }));
    const points = map.get("pv") ?? [];
    expect(points.length).toBe(MAX_POINTS);
    expect(points.at(-1)).toEqual({ t: 1000 + MAX_POINTS + 49, v: MAX_POINTS + 49 });
  });
});

// Expanding the compact payload back into absolute-time points is an internal
// step, not an API — the buffers are the product — so it is exercised where it
// lands: through `seedBackfill`. Every guard below defends against a malformed
// payload becoming a NaN timestamp, which draws as an invisible line rather than
// raising anything.
describe("the compact payload expands into buffers", () => {
  test("offsets expand to absolute ms via t0 + o * step * 1000", () => {
    const map = sink();
    new LiveSeries(map).seedBackfill(payload(1_000_000, { pv: { o: [0, 1, 3], v: [1, 2, 3] } }));
    expect(map.get("pv")).toEqual([
      { t: 1_000_000, v: 1 },
      { t: 1_001_000, v: 2 },
      { t: 1_003_000, v: 3 },
    ]);
  });

  test("a step wider than a second scales the offsets", () => {
    const map = sink();
    new LiveSeries(map).seedBackfill(payload(1_000_000, { pv: { o: [0, 2], v: [1, 2] } }, 5));
    expect(map.get("pv")).toEqual([
      { t: 1_000_000, v: 1 },
      { t: 1_010_000, v: 2 },
    ]);
  });

  test("an empty metric map writes nothing at all, and does not throw", () => {
    const map = sink();
    new LiveSeries(map).seedBackfill(payload(1000, {}));
    expect(map.size).toBe(0);
  });

  // Pinned deliberately: a metric with no buckets in the window is a PRESENT key
  // holding an empty series ("this metric reported nothing"), not a dropped one.
  // That is exactly how the full-replace path clears a stale line.
  test("a metric with empty o/v clears its buffer rather than leaving it stale", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.seedBackfill(payload(2000, { pv: { o: [], v: [] } }));
    expect(map.has("pv")).toBe(true);
    expect(map.get("pv")).toEqual([]);
  });

  test("o longer than v truncates to the shorter — never an undefined value", () => {
    const map = sink();
    new LiveSeries(map).seedBackfill(payload(1000, { pv: { o: [0, 1, 2], v: [5] } }));
    expect(map.get("pv")).toEqual([{ t: 1000, v: 5 }]);
  });

  test("v longer than o truncates the same way", () => {
    const map = sink();
    new LiveSeries(map).seedBackfill(payload(1000, { pv: { o: [0], v: [5, 6, 7] } }));
    expect(map.get("pv")).toEqual([{ t: 1000, v: 5 }]);
  });

  test("a step of 0 is dropped rather than collapsing every point onto t0", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.seedBackfill(payload(1000, { pv: { o: [0, 1], v: [1, 2] } }, 0));
    // Unusable payload: the held points stand, and nothing stamped NaN lands.
    expect(map.get("pv")).toEqual([{ t: 1000, v: 1 }]);
  });

  test("a non-finite t0 is dropped too — no NaN timestamps reach a buffer", () => {
    const map = sink();
    new LiveSeries(map).seedBackfill(payload(Number.NaN, { pv: { o: [0, 1], v: [1, 2] } }));
    expect(map.size).toBe(0);
  });

  test("zero and negative values are preserved — 0 kW and −350 W are readings", () => {
    const map = sink();
    new LiveSeries(map).seedBackfill(payload(1000, { grid: { o: [0, 1], v: [0, -350] } }));
    expect(map.get("grid")).toEqual([
      { t: 1000, v: 0 },
      { t: 2000, v: -350 },
    ]);
  });
});

describe("backfillSeconds", () => {
  const FULL = WINDOW_MS / 1000;

  test("nothing held yet asks for the whole window", () => {
    expect(backfillSeconds(null, 1_000_000)).toBe(FULL);
  });

  test("a 10 s gap asks for the gap plus the overlap, not the window", () => {
    // 10 s of gap plus the 2 s request overlap that lets the merge replace the
    // points it re-states instead of duplicating them.
    expect(backfillSeconds(1_000_000, 1_010_000)).toBe(12);
  });

  test("a sub-second gap still asks for at least one second — the route rejects 0", () => {
    expect(backfillSeconds(1_000_000, 1_000_400)).toBeGreaterThanOrEqual(1);
  });

  test("a gap of exactly the window is a full refetch — merging into it buys nothing", () => {
    expect(backfillSeconds(1_000_000, 1_000_000 + WINDOW_MS)).toBe(FULL);
  });

  test("a gap wider than the window is a full refetch too", () => {
    expect(backfillSeconds(1_000_000, 1_000_001 + WINDOW_MS)).toBe(FULL);
  });

  // Clock skew, and it is the ordinary case rather than an exotic one: held
  // timestamps are SERVER-stamped (the WS frame's `time`), while `nowMs` comes
  // from the BROWSER. A browser running behind the server makes the measured gap
  // zero or negative even though real seconds are missing. Clamping that to 1
  // would fetch one second, and `mergeBackfill` would leave the rest of the hole
  // unfilled — drawn as a straight line, never as an error. A non-positive gap
  // means the two clocks disagree, so the measurement is worthless: take the
  // full window, which is correct under any skew.
  test("a browser clock behind the server takes the FULL window, not a 1 s sliver", () => {
    // Browser 1 s behind, 3 s of frames actually missed → gap reads −1.
    expect(backfillSeconds(1_000_000, 999_000)).toBe(FULL);
  });

  test("a gap of exactly zero is skew too — the full window, not 1", () => {
    expect(backfillSeconds(1_000_000, 1_000_000)).toBe(FULL);
  });

  test("the skew fallback never returns something the merge path would use", () => {
    // Both skewed widths must be full-width, i.e. they take seedBackfill.
    expect(isFullBackfill(backfillSeconds(1_000_000, 999_000))).toBe(true);
    expect(isFullBackfill(backfillSeconds(1_000_000, 1_000_000))).toBe(true);
  });

  test("never asks for more than the route's 3600 s ceiling", () => {
    expect(backfillSeconds(0, 1_000_000_000)).toBeLessThanOrEqual(3600);
  });
});

// The riskiest single line of the backfill change: the wrong way round either
// blanks the dashboard (seeding from a 3 s payload clears every metric the gap
// did not mention) or leaves a permanently stale line (merging a full window
// onto stale points). It lives here rather than inside the store's closure so
// both the store and this suite call the SAME predicate — a test that copied the
// branch would stay green with the real one inverted.
describe("isFullBackfill", () => {
  test("the full window width is authoritative — it seeds", () => {
    expect(isFullBackfill(WINDOW_MS / 1000)).toBe(true);
  });

  test("anything wider than the window seeds too", () => {
    expect(isFullBackfill(WINDOW_MS / 1000 + 1)).toBe(true);
  });

  test("one second short of the window is still only a gap — it merges", () => {
    expect(isFullBackfill(WINDOW_MS / 1000 - 1)).toBe(false);
  });

  test("a typical resume width merges", () => {
    expect(isFullBackfill(backfillSeconds(1_000_000, 1_010_000))).toBe(false);
  });

  test("degenerate widths are not full — 0 and negatives must never seed", () => {
    expect(isFullBackfill(0)).toBe(false);
    expect(isFullBackfill(-5)).toBe(false);
  });
});

describe("LiveSeries.newestHeldMs", () => {
  test("no buffers at all is null — the caller must ask for the full window", () => {
    expect(new LiveSeries(sink()).newestHeldMs()).toBeNull();
  });

  test("is the newest last-point across every metric, not just the first", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.appendSample(sample(5000, { load: 2 }));
    expect(s.newestHeldMs()).toBe(5000);
  });

  test("an empty buffer for a metric does not become a 0 timestamp", () => {
    const map = sink();
    map.set("pv", []);
    expect(new LiveSeries(map).newestHeldMs()).toBeNull();
  });
});

describe("LiveSeries.seedBackfill — the full-replace path", () => {
  test("expands each metric ascending into its own buffer", () => {
    const map = sink();
    new LiveSeries(map).seedBackfill(
      payload(1000, {
        pv: series(1000, [
          [1000, 10],
          [2000, 20],
          [3000, 30],
        ]),
        load: series(1000, [[3000, 3]]),
      }),
    );
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 10 },
      { t: 2000, v: 20 },
      { t: 3000, v: 30 },
    ]);
    expect(map.get("load")).toEqual([{ t: 3000, v: 3 }]);
  });

  test("keeps only the trailing window of a long backfill", () => {
    const map = sink();
    const newest = 10 * WINDOW_MS;
    new LiveSeries(map).seedBackfill(
      payload(newest - WINDOW_MS - 1000, {
        pv: series(newest - WINDOW_MS - 1000, [
          [newest - WINDOW_MS - 1000, 1],
          [newest - WINDOW_MS, 2],
          [newest, 3],
        ]),
      }),
    );
    expect(map.get("pv")).toEqual([
      { t: newest - WINDOW_MS, v: 2 },
      { t: newest, v: 3 },
    ]);
  });

  test("a denser-than-cap series is cut to the hard point cap", () => {
    const map = sink();
    const o: number[] = [];
    const v: number[] = [];
    for (let i = 0; i < MAX_POINTS + 50; i++) {
      o.push(i);
      v.push(i);
    }
    new LiveSeries(map).seedBackfill(payload(0, { pv: { o, v } }, 0.001));
    expect((map.get("pv") ?? []).length).toBe(MAX_POINTS);
  });

  test("a resume replaces the stale buffer rather than merging into it", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.seedBackfill(payload(60_000, { pv: series(60_000, [[60_000, 9]]) }));
    expect(map.get("pv")).toEqual([{ t: 60_000, v: 9 }]);
  });

  // THE ASYMMETRY, half one: a full backfill is the whole truth about the
  // window, so a metric it does not mention has no data — its line must clear
  // rather than hang stale on the screen.
  test("a metric absent from a NON-EMPTY full backfill has its buffer cleared", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1, dead: 5 }));
    s.seedBackfill(payload(2000, { pv: series(2000, [[2000, 2]]) }));
    expect(map.get("pv")).toEqual([{ t: 2000, v: 2 }]);
    expect(map.get("dead") ?? []).toEqual([]);
  });

  // …but a wholly empty response is "the server told us nothing", not "every
  // metric is dead". Wiping the page on one such answer is the worse failure.
  test("an entirely empty payload leaves the buffers alone", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.seedBackfill(payload(0, {}));
    expect(map.get("pv")).toEqual([{ t: 1000, v: 1 }]);
  });

  test("a null or undefined payload is a no-op, not a wipe", () => {
    // A fetch that failed or returned nothing must not blank the dashboard.
    for (const absent of [null, undefined]) {
      const map = sink();
      const s = new LiveSeries(map);
      s.appendSample(sample(1000, { pv: 1 }));
      s.seedBackfill(absent);
      expect(map.get("pv")).toEqual([{ t: 1000, v: 1 }]);
    }
  });

  test("live points append onto the seeded buffer", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.seedBackfill(payload(1000, { pv: series(1000, [[1000, 1]]) }));
    s.appendSample(sample(2000, { pv: 2 }));
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 1 },
      { t: 2000, v: 2 },
    ]);
  });
});

describe("LiveSeries.mergeBackfill — the gap-resume path", () => {
  test("appends the gap onto what is already held", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.appendSample(sample(2000, { pv: 2 }));
    s.mergeBackfill(
      payload(3000, {
        pv: series(3000, [
          [3000, 3],
          [4000, 4],
        ]),
      }),
    );
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 1 },
      { t: 2000, v: 2 },
      { t: 3000, v: 3 },
      { t: 4000, v: 4 },
    ]);
  });

  // The 2 s overlap means the payload re-states points we already hold. The
  // backfilled bucket is authoritative, so it replaces rather than duplicates —
  // otherwise every resume leaves a visible vertical stutter in the sparkline.
  test("a backfilled point at a held timestamp replaces it instead of duplicating", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.appendSample(sample(2000, { pv: 2 }));
    s.mergeBackfill(
      payload(2000, {
        pv: series(2000, [
          [2000, 22],
          [3000, 33],
        ]),
      }),
    );
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 1 },
      { t: 2000, v: 22 },
      { t: 3000, v: 33 },
    ]);
  });

  test("held points INSIDE the payload's span are dropped, not interleaved", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.appendSample(sample(5000, { pv: 5 }));
    s.mergeBackfill(
      payload(2000, {
        pv: series(2000, [
          [2000, 2],
          [6000, 6],
        ]),
      }),
    );
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 1 },
      { t: 2000, v: 2 },
      { t: 6000, v: 6 },
    ]);
  });

  // `metrics_raw` lags the live stream by up to HISTORY_FLUSH_INTERVAL_MS
  // (5 s by default, env-tunable), so a gap request can come back with rows that
  // stop SHORT of the newest point already held: gap 4 s, flush lag 5 s. Dropping
  // everything at or after the payload's FIRST bucket then deletes held points
  // the payload never covers, and nothing replaces them — the buffer's newest
  // point jumps BACKWARDS and the sparkline loses its most recent seconds. Only
  // the region the payload RE-STATES may be dropped.
  test("held points NEWER than the payload's last bucket survive — flush lag must not delete them", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.appendSample(sample(2000, { pv: 2 }));
    s.appendSample(sample(6000, { pv: 6 }));
    s.appendSample(sample(7000, { pv: 7 }));
    // The DB only reached 3000–4000: older than the 6000/7000 we already hold.
    s.mergeBackfill(
      payload(2000, {
        pv: series(2000, [
          [2000, 22],
          [3000, 33],
        ]),
      }),
    );
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 1 },
      { t: 2000, v: 22 },
      { t: 3000, v: 33 },
      { t: 6000, v: 6 },
      { t: 7000, v: 7 },
    ]);
  });

  test("a merge can never move the newest held timestamp backwards", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(9000, { pv: 9 }));
    s.mergeBackfill(payload(4000, { pv: series(4000, [[4000, 4]]) }));
    expect(s.newestHeldMs()).toBe(9000);
  });

  // THE ASYMMETRY, half two: a partial backfill only describes the gap, so a
  // metric it omits simply produced nothing during those few seconds. Clearing
  // it here (as the full path does) would blank half the dashboard on every
  // tab switch.
  test("a metric absent from a PARTIAL backfill keeps its existing points", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1, quiet: 7 }));
    s.mergeBackfill(payload(2000, { pv: series(2000, [[2000, 2]]) }));
    expect(map.get("quiet")).toEqual([{ t: 1000, v: 7 }]);
  });

  test("a metric new to the buffers arrives through the merge", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.mergeBackfill(payload(2000, { fresh: series(2000, [[2000, 9]]) }));
    expect(map.get("fresh")).toEqual([{ t: 2000, v: 9 }]);
  });

  test("an empty payload is a no-op, never a wipe", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    s.mergeBackfill(payload(0, {}));
    s.mergeBackfill(null);
    expect(map.get("pv")).toEqual([{ t: 1000, v: 1 }]);
  });

  test("merging enforces the trailing window — a gap-resume drops what aged out", () => {
    const map = sink();
    const s = new LiveSeries(map);
    s.appendSample(sample(1000, { pv: 1 }));
    const newest = 1000 + WINDOW_MS + 1;
    s.mergeBackfill(payload(newest, { pv: series(newest, [[newest, 2]]) }));
    expect(map.get("pv")).toEqual([{ t: newest, v: 2 }]);
  });

  // Without trim() on this path, a long run of short hide/show cycles grows the
  // buffer one merge at a time until it is past the cap — invisible until the
  // page starts stuttering.
  test("repeated short resumes cannot grow a buffer past the hard cap", () => {
    const map = sink();
    const s = new LiveSeries(map);
    for (let i = 0; i < MAX_POINTS + 200; i++) {
      s.mergeBackfill(payload(0, { pv: { o: [i], v: [i] } }, 0.001));
    }
    expect((map.get("pv") ?? []).length).toBeLessThanOrEqual(MAX_POINTS);
  });
});

/** Records what the feed did, in order, and lets a test resolve the backfill by hand. */
function harness(options: { failBackfill?: boolean } = {}) {
  const log: string[] = [];
  let emit: ((sample: LiveSample) => void) | null = null;
  let settle: (() => void) | null = null;
  const feed = new MetricsFeed({
    backfill: () =>
      new Promise<void>((resolve, reject) => {
        log.push("backfill");
        settle = () => {
          log.push("seeded");
          if (options.failBackfill) reject(new Error("network down"));
          else resolve();
        };
      }),
    subscribe: (on) => {
      log.push("sub");
      emit = on;
      return () => log.push("unsub");
    },
    onSample: (s) => log.push(`sample:${s.time}`),
  });
  return {
    feed,
    log,
    /** Resolve the in-flight backfill and let the continuation run. */
    seed: async () => {
      settle?.();
      settle = null;
      await Promise.resolve();
      await Promise.resolve();
    },
    send: (time: string) => emit?.({ time, inverterId: "inv", metrics: { pv: 1 } }),
  };
}

describe("MetricsFeed", () => {
  test("seeds the buffers before it takes the topic, never after", async () => {
    const h = harness();
    h.feed.lease();
    expect(h.log).toEqual(["backfill"]);
    await h.seed();
    expect(h.log).toEqual(["backfill", "seeded", "sub"]);
  });

  test("a backfill that fails still takes the topic, so one bad fetch is a gap and not an outage", async () => {
    // The sparkline history is a nicety; the live numbers are the page. A
    // rejected `/api/history/recent` used to skip the subscribe entirely, so a
    // single transient failure at load left every reading dead until the tab
    // was hidden and shown again.
    const h = harness({ failBackfill: true });
    h.feed.lease();
    await h.seed();
    expect(h.log).toEqual(["backfill", "seeded", "sub"]);
    h.send("2026-08-16T06:00:00Z");
    expect(h.log).toContain("sample:2026-08-16T06:00:00Z");
  });

  test("frames land once the lease is open", async () => {
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.send("t1");
    expect(h.log.at(-1)).toBe("sample:t1");
  });

  test("a lease dropped during the backfill never takes the topic", async () => {
    const h = harness();
    const release = h.feed.lease();
    release();
    await h.seed();
    expect(h.log).toEqual(["backfill", "seeded"]);
  });

  test("gives the topic back when the lease goes, and only once", async () => {
    const h = harness();
    const release = h.feed.lease();
    await h.seed();
    release();
    release();
    expect(h.log).toEqual(["backfill", "seeded", "sub", "unsub"]);
  });

  test("a hidden tab stops consuming frames", async () => {
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.feed.setHidden(true);
    h.send("hidden");
    expect(h.log).not.toContain("sample:hidden");
  });

  test("coming back backfills first, so the buffers jump to the newest data", async () => {
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.feed.setHidden(true);
    h.feed.setHidden(false);
    expect(h.log.at(-1)).toBe("backfill");
    await h.seed();
    h.send("back");
    expect(h.log).toEqual([
      "backfill",
      "seeded",
      "sub",
      "backfill",
      "seeded",
      // The topic was never given back, so coming back costs no second `sub`.
      "sample:back",
    ]);
  });

  test("frames arriving during the resume backfill are dropped, not replayed", async () => {
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.feed.setHidden(true);
    h.feed.setHidden(false);
    h.send("mid");
    expect(h.log).not.toContain("sample:mid");
    await h.seed();
    h.send("after");
    expect(h.log.at(-1)).toBe("sample:after");
  });

  test("hiding again mid-backfill abandons it instead of resuming behind our back", async () => {
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.feed.setHidden(true);
    h.feed.setHidden(false);
    h.feed.setHidden(true);
    await h.seed();
    h.send("still-hidden");
    expect(h.log).not.toContain("sample:still-hidden");
  });

  test("a repeated visibility event costs nothing", async () => {
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.feed.setHidden(true);
    h.feed.setHidden(true);
    expect(h.log.filter((entry) => entry === "backfill").length).toBe(1);
    h.feed.setHidden(false);
    h.feed.setHidden(false);
    expect(h.log.filter((entry) => entry === "backfill").length).toBe(2);
  });

  test("a lease taken while hidden waits for the tab instead of fetching", () => {
    const h = harness();
    h.feed.setHidden(true);
    h.feed.lease();
    expect(h.log).toEqual([]);
  });

  test("dropping the lease while hidden still releases the topic", async () => {
    const h = harness();
    const release = h.feed.lease();
    await h.seed();
    h.feed.setHidden(true);
    release();
    expect(h.log.at(-1)).toBe("unsub");
  });
});

// The store keeps MetricsFeed dumb: the injected closure asks LiveSeries what it
// already holds and sizes the request from that. This composes the same three
// pieces the store does, so the "first load is full, resume is a gap" contract is
// pinned without a rune shell.
describe("the store's backfill closure — full window on load, gap window on resume", () => {
  function composed() {
    const map = sink();
    const live = new LiveSeries(map);
    const asked: number[] = [];
    const took: string[] = [];
    let now = 1_000_000;
    const feed = new MetricsFeed({
      backfill: async () => {
        const seconds = backfillSeconds(live.newestHeldMs(), now);
        asked.push(seconds);
        const p = payload(now, { pv: series(now, [[now, 1]]) });
        // The REAL predicate, not a copy of it — inverting `isFullBackfill`
        // has to turn this suite red.
        took.push(isFullBackfill(seconds) ? "seed" : "merge");
        if (isFullBackfill(seconds)) live.seedBackfill(p);
        else live.mergeBackfill(p);
      },
      subscribe: () => () => {},
      onSample: () => {},
    });
    return { feed, asked, took, map, advance: (ms: number) => (now += ms) };
  }

  test("the first lease asks for the whole window; a resume 10 s later asks for the gap", async () => {
    const c = composed();
    c.feed.lease();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.asked).toEqual([WINDOW_MS / 1000]);

    c.feed.setHidden(true);
    c.advance(10_000);
    c.feed.setHidden(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.asked[1]).toBe(10 + 2); // the gap, plus the request overlap
    // …and each width picked the matching path.
    expect(c.took).toEqual(["seed", "merge"]);
  });

  // A browser clock behind the server: `now` goes BACKWARDS across the hide even
  // though real time passed. The width must be the full window, and the full
  // window must seed — the path that actually jumps the buffers to current data.
  test("a backwards browser clock across a hide seeds the full window", async () => {
    const c = composed();
    c.feed.lease();
    await Promise.resolve();
    await Promise.resolve();
    c.feed.setHidden(true);
    c.advance(-5000);
    c.feed.setHidden(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.asked[1]).toBe(WINDOW_MS / 1000);
    expect(c.took).toEqual(["seed", "seed"]);
  });

  test("a hide longer than the window falls back to a full refetch", async () => {
    const c = composed();
    c.feed.lease();
    await Promise.resolve();
    await Promise.resolve();
    c.feed.setHidden(true);
    c.advance(WINDOW_MS + 5000);
    c.feed.setHidden(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.asked[1]).toBe(WINDOW_MS / 1000);
  });
});

// Switching to another device makes everything held about the previous one
// wrong: its sparkline buffers are a different machine's history, and its last
// sample is a different machine's numbers.
describe("switching device", () => {
  test("clearing empties every buffer", () => {
    const map = sink();
    const live = new LiveSeries(map);
    live.appendSample(sample(0, { pv: 1, soc: 2 }));

    live.clear();

    expect(map.size).toBe(0);
  });

  test("a buffer cleared then refilled holds only the new device's points", () => {
    // Merging would splice two machines' histories into one line — and two
    // devices of the same model share metric keys, so nothing downstream could
    // tell them apart.
    const map = sink();
    const live = new LiveSeries(map);
    live.appendSample(sample(0, { pv: 1 }));

    live.clear();
    live.appendSample(sample(1000, { pv: 9 }));

    expect((map.get("pv") ?? []).map((point) => point.v)).toEqual([9]);
  });

  test("restarting re-runs the backfill and keeps the one topic subscription", async () => {
    // The rows held are the old device's, so they have to be refetched. The
    // topic itself is re-pointed by the bus, not by giving it back here.
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.log.length = 0;

    h.feed.restart();
    await h.seed();

    expect(h.log).toEqual(["backfill", "seeded"]);
  });

  test("a frame that arrives mid-restart is not applied", async () => {
    // Between the switch and the new backfill landing, a frame in flight is the
    // *old* device's — applying it would paint the machine just switched away
    // from, at the current time.
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.log.length = 0;

    h.feed.restart();
    h.send("2026-08-15T10:00:00.000Z");

    expect(h.log).toEqual(["backfill"]);
  });

  test("frames land again once the new backfill has settled", async () => {
    const h = harness();
    h.feed.lease();
    await h.seed();
    h.feed.restart();
    await h.seed();
    h.log.length = 0;

    h.send("2026-08-15T10:00:01.000Z");

    expect(h.log).toEqual(["sample:2026-08-15T10:00:01.000Z"]);
  });

  test("restarting without a lease does nothing", async () => {
    // Nothing is consuming, so there is nothing to re-seed for.
    const h = harness();

    h.feed.restart();

    expect(h.log).toEqual([]);
  });
});
