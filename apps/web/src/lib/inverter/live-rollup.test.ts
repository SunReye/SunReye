import { describe, expect, test } from "bun:test";
import { feedsFor, rollupFeed, type RollupQuery } from "./live-rollup";
import type { LiveWindow, RollupRow } from "./live-tail";

// The whole lifecycle both history charts run — the window fetched once, a
// delta per minute tick, cancellation on the way out — against a fake API and
// a fake clock, so the effect wiring's bookkeeping is testable without runes.

const MIN = 60_000;
const MIDNIGHT = Date.parse("2026-08-02T00:00:00Z");
const at = (minutes: number) => MIDNIGHT + minutes * MIN;
const iso = (minutes: number) => new Date(at(minutes)).toISOString();

/** Today at minute grain: the window the Day tab standing on today fetches. */
const TODAY: LiveWindow = {
  from: new Date(MIDNIGHT),
  to: new Date(at(24 * 60)),
  bucket: "minute",
};

/** Rows for minutes `[first, last]`, avg = the minute. */
const rows = (first: number, last: number): RollupRow[] =>
  Array.from({ length: last - first + 1 }, (_, i) => {
    const m = first + i;
    return { time: iso(m), avg: m, min: m, max: m };
  });

type Call = { query: RollupQuery; answer: (data: unknown) => void };

function harness(startAt = at(600)) {
  let clock = startAt;
  const calls: Call[] = [];
  const seen = { rows: [] as Record<string, RollupRow[]>[], loading: [] as boolean[] };
  const feed = rollupFeed({
    api: {
      rollup: (query) =>
        new Promise((resolve) => calls.push({ query, answer: (data) => resolve({ data }) })),
    },
    now: () => clock,
    onRows: (next) => seen.rows.push(next),
    onLoading: (loading) => seen.loading.push(loading),
  });
  return {
    feed,
    calls,
    seen,
    tick: (to: number) => (clock = to),
    /** Answer every outstanding call for `metric` with `data`. */
    answer: (metric: string, data: unknown) =>
      calls.filter((c) => c.query.metric === metric).forEach((c) => c.answer(data)),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the window, fetched once", () => {
  test("asks for each key over the whole window, at its grain, scoped to the source", () => {
    const { feed, calls } = harness();
    feed.load(["pv", "load"], TODAY, { source: "inverter-2" }, at(600));
    expect(calls.map((c) => c.query)).toEqual(
      ["pv", "load"].map((metric) => ({
        metric,
        from: TODAY.from.toISOString(),
        to: TODAY.to.toISOString(),
        bucket: "minute",
        // A 7-day window at minute grain is ~10k points; a lower cap truncates
        // the ascending query to its oldest slice.
        limit: 12000,
        source: "inverter-2",
      })),
    );
  });

  test("an unscoped caller sends no source at all", () => {
    const { feed, calls } = harness();
    feed.load(["pv"], TODAY, {}, at(600));
    expect(calls[0]!.query).not.toHaveProperty("source");
  });

  test("a per-series scope reads each key under its own source", () => {
    const { feed, calls } = harness();
    const scopeOf = (metric: string) => ({ source: metric === "pv" ? "inverter-2" : "plant" });
    feed.load(["pv", "load"], TODAY, scopeOf, at(600));
    expect(calls.map((c) => [c.query.metric, c.query.source])).toEqual([
      ["pv", "inverter-2"],
      ["load", "plant"],
    ]);
  });

  test("the delta keeps each key's own source", async () => {
    const { feed, calls, tick, answer } = harness();
    const scopeOf = (metric: string) => ({ source: metric === "pv" ? "inverter-2" : "plant" });
    feed.load(["pv", "load"], TODAY, scopeOf, at(600));
    answer("pv", rows(0, 599));
    answer("load", rows(0, 599));
    await flush();
    tick(at(602));
    feed.append(["pv", "load"], TODAY, scopeOf, at(602));
    expect(calls.slice(2).map((c) => [c.query.metric, c.query.source])).toEqual([
      ["pv", "inverter-2"],
      ["load", "plant"],
    ]);
  });

  test("lands every key's rows together, and only then stops loading", async () => {
    const { feed, seen, answer } = harness();
    feed.load(["pv", "load"], TODAY, {}, at(600));
    expect(seen.loading).toEqual([true]);
    answer("pv", rows(0, 599));
    await flush();
    expect(seen.rows).toEqual([]);
    answer("load", null);
    await flush();
    expect(seen.rows).toEqual([{ pv: rows(0, 599), load: [] }]);
    expect(seen.loading).toEqual([true, false]);
  });

  test("no keys is an empty answer, not a spinner forever", async () => {
    const { feed, seen } = harness();
    feed.load([], TODAY, {}, at(600));
    await flush();
    expect(seen.rows).toEqual([{}]);
    expect(seen.loading.at(-1)).toBe(false);
  });

  test("a load disposed before it lands writes nothing, and the rows held stay", async () => {
    const { feed, seen, answer } = harness();
    const dispose = feed.load(["pv"], TODAY, {}, at(600));
    dispose();
    answer("pv", rows(0, 599));
    await flush();
    expect(seen.rows).toEqual([]);
    expect(feed.loading).toBe(true);
  });
});

describe("the delta on a minute tick", () => {
  /** A feed holding minutes 0–599 of `keys`, landed at 10:00. */
  async function landed(keys: string[] = ["pv"], held = rows(0, 599)) {
    const h = harness(at(600));
    h.feed.load(keys, TODAY, {}, at(600));
    for (const key of keys) h.answer(key, held);
    await flush();
    h.calls.length = 0;
    return h;
  }

  test("asks for nothing while the window is still loading", () => {
    const { feed, calls } = harness();
    feed.load(["pv"], TODAY, {}, at(600));
    calls.length = 0;
    expect(feed.append(["pv"], TODAY, {}, at(601))).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("asks for nothing in the minute the window landed in — its own answer is no tick", async () => {
    const { feed, calls } = await landed();
    feed.append(["pv"], TODAY, {}, at(600));
    expect(calls).toEqual([]);
  });

  test("the landing minute is read off the clock when the answer arrives, not when it was asked", async () => {
    const h = harness(at(600));
    h.feed.load(["pv"], TODAY, {}, at(600));
    h.tick(at(601)); // the fetch took the minute over
    h.answer("pv", rows(0, 600));
    await flush();
    h.calls.length = 0;
    h.feed.append(["pv"], TODAY, {}, at(601));
    expect(h.calls).toEqual([]);
  });

  test("a new minute asks once, from the newest bucket held, to the window's end", async () => {
    const { feed, calls } = await landed();
    feed.append(["pv"], TODAY, {}, at(601));
    expect(calls.map((c) => [c.query.from, c.query.to])).toEqual([
      [iso(599), TODAY.to.toISOString()],
    ]);
  });

  test("the answer replaces the partial bucket and extends the rows", async () => {
    const { feed, seen, answer } = await landed();
    feed.append(["pv"], TODAY, {}, at(601));
    const fresh = [
      { time: iso(599), avg: 42, min: 42, max: 42 },
      { time: iso(600), avg: 600, min: 600, max: 600 },
    ];
    answer("pv", fresh);
    await flush();
    const merged = seen.rows.at(-1)!.pv!;
    expect(merged).toHaveLength(601);
    expect(merged.at(-2)).toEqual(fresh[0]!);
    expect(merged.at(-1)).toEqual(fresh[1]!);
  });

  test("asking twice in one minute is one request", async () => {
    const { feed, calls } = await landed();
    feed.append(["pv"], TODAY, {}, at(601));
    feed.append(["pv"], TODAY, {}, at(601));
    expect(calls).toHaveLength(1);
  });

  test("rows that already reach the ticking minute need nothing", async () => {
    const { feed, calls } = await landed(["pv"], rows(0, 601));
    feed.append(["pv"], TODAY, {}, at(601));
    expect(calls).toEqual([]);
  });

  test("one window for every key, sized for the one that lags furthest", async () => {
    const h = harness(at(600));
    h.feed.load(["pv", "load"], TODAY, {}, at(600));
    h.answer("pv", rows(0, 599));
    h.answer("load", rows(0, 590));
    await flush();
    h.calls.length = 0;
    h.feed.append(["pv", "load"], TODAY, {}, at(601));
    expect(h.calls.map((c) => [c.query.metric, c.query.from])).toEqual([
      ["pv", iso(590)],
      ["load", iso(590)],
    ]);
  });

  test("a delta disposed before it lands merges nothing", async () => {
    const { feed, seen, answer } = await landed();
    const before = seen.rows.length;
    const dispose = feed.append(["pv"], TODAY, {}, at(601));
    dispose?.();
    answer("pv", rows(599, 600));
    await flush();
    expect(seen.rows).toHaveLength(before);
  });

  test("an empty delta leaves the rows as they are", async () => {
    const { feed, seen, answer } = await landed();
    const before = seen.rows.length;
    feed.append(["pv"], TODAY, {}, at(601));
    answer("pv", []);
    await flush();
    expect(seen.rows).toHaveLength(before);
  });

  test("past midnight, the delta re-asks the day's last bucket and never reaches into tomorrow", async () => {
    const { feed, calls } = await landed(["pv"], rows(0, 24 * 60 - 1));
    feed.append(["pv"], TODAY, {}, at(24 * 60 + 5));
    expect(calls.map((c) => [c.query.from, c.query.to])).toEqual([
      [iso(24 * 60 - 1), TODAY.to.toISOString()],
    ]);
  });
});

describe("what a chart draws", () => {
  const frames = [{ t: at(600), v: 1 }];

  test("one feed per key, in the order asked, with the rows held for it", () => {
    const held = { load: rows(0, 1), pv: rows(0, 2) };
    expect(feedsFor(["pv", "load"], held, null).map((f) => [f.key, f.rows.length])).toEqual([
      ["pv", 3],
      ["load", 2],
    ]);
  });

  test("a key nothing was fetched for yet draws no rows", () => {
    expect(feedsFor(["pv"], {}, null)).toEqual([{ key: "pv", rows: [], live: [] }]);
  });

  test("a live window carries each key's frame buffer; a closed one carries none", () => {
    expect(feedsFor(["pv"], {}, () => frames)[0]!.live).toEqual(frames);
    expect(feedsFor(["pv"], {}, null)[0]!.live).toEqual([]);
  });
});
