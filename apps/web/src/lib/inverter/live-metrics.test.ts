import { describe, expect, test } from "bun:test";
import { LiveSeries, MAX_POINTS, MetricsFeed, WINDOW_MS } from "./live-metrics";
import type { LivePoint, LiveSample } from "./types";

/** Plain-Map stand-in for the store's `SvelteMap` — the sink is injected, so no runes here. */
function sink(): Map<string, LivePoint[]> {
  return new Map<string, LivePoint[]>();
}

function sample(time: number, metrics: Record<string, number>): LiveSample {
  return { time: new Date(time).toISOString(), inverterId: "inv", metrics };
}

function row(metric: string, time: number, value: number) {
  return { metric, time: new Date(time).toISOString(), value };
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

describe("LiveSeries.seedRows", () => {
  test("groups the backfill per metric and sorts it oldest-first", () => {
    const map = sink();
    // The endpoint answers newest-first.
    new LiveSeries(map).seedRows([
      row("pv", 3000, 30),
      row("load", 3000, 3),
      row("pv", 2000, 20),
      row("pv", 1000, 10),
    ]);
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 10 },
      { t: 2000, v: 20 },
      { t: 3000, v: 30 },
    ]);
    expect(map.get("load")).toEqual([{ t: 3000, v: 3 }]);
  });

  test("downsamples a denser-than-1-Hz backfill to the live stream's density", () => {
    const map = sink();
    new LiveSeries(map).seedRows([
      row("pv", 1000, 1),
      row("pv", 1200, 2),
      row("pv", 1900, 3),
      row("pv", 2400, 4),
    ]);
    // One point per second, the last of each bucket — what the live feed produces.
    expect(map.get("pv")).toEqual([
      { t: 1900, v: 3 },
      { t: 2400, v: 4 },
    ]);
  });

  test("keeps only the trailing window of a long backfill", () => {
    const map = sink();
    const newest = 10 * WINDOW_MS;
    new LiveSeries(map).seedRows([
      row("pv", newest, 3),
      row("pv", newest - WINDOW_MS, 2),
      row("pv", newest - WINDOW_MS - 1000, 1),
    ]);
    expect(map.get("pv")).toEqual([
      { t: newest - WINDOW_MS, v: 2 },
      { t: newest, v: 3 },
    ]);
  });

  test("an empty backfill leaves the buffers alone", () => {
    const map = sink();
    const series = new LiveSeries(map);
    series.appendSample(sample(1000, { pv: 1 }));
    series.seedRows([]);
    expect(map.get("pv")).toEqual([{ t: 1000, v: 1 }]);
  });

  test("a resume backfill replaces the stale buffer rather than merging into it", () => {
    const map = sink();
    const series = new LiveSeries(map);
    series.appendSample(sample(1000, { pv: 1 }));
    series.seedRows([row("pv", 60_000, 9)]);
    expect(map.get("pv")).toEqual([{ t: 60_000, v: 9 }]);
  });

  test("live points append onto the seeded buffer", () => {
    const map = sink();
    const series = new LiveSeries(map);
    series.seedRows([row("pv", 1000, 1)]);
    series.appendSample(sample(2000, { pv: 2 }));
    expect(map.get("pv")).toEqual([
      { t: 1000, v: 1 },
      { t: 2000, v: 2 },
    ]);
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
