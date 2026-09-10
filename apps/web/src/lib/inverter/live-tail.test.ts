import { describe, expect, it } from "bun:test";
import type { LivePoint } from "./types";
import {
  dueRefresh,
  fetchWindow,
  liveTailPoints,
  mergeRollup,
  rollupPoints,
  type RollupRow,
} from "./live-tail";

const MINUTE = 60_000;

/** Local midnight of the day 2026-05-14, the anchor `ranges.test.ts` uses. */
const MIDNIGHT = new Date(2026, 4, 14, 0, 0, 0, 0);
const NEXT_MIDNIGHT = new Date(2026, 4, 15, 0, 0, 0, 0);

/** The window the Day tab standing on today resolves to. */
const TODAY = { from: MIDNIGHT, to: NEXT_MIDNIGHT, bucket: "minute" } as const;

/** A minute rollup row at `minutesAfterMidnight`. */
function row(minutesAfterMidnight: number, avg = 100): RollupRow {
  return {
    time: new Date(MIDNIGHT.getTime() + minutesAfterMidnight * MINUTE).toISOString(),
    avg,
    min: avg - 10,
    max: avg + 10,
  };
}

/** A live sample `secondsAfterMidnight` into the day. */
function sample(secondsAfterMidnight: number, v: number): LivePoint {
  return { t: MIDNIGHT.getTime() + secondsAfterMidnight * 1000, v };
}

describe("dueRefresh — the delta a still-running window needs", () => {
  /** Clock reading `minutes` into the day, in the units the card holds. */
  const at = (minutes: number, seconds = 0) =>
    MIDNIGHT.getTime() + minutes * MINUTE + seconds * 1000;

  /** Nothing synced yet — the initial fetch has not landed. */
  const NEVER = 0;

  it("asks for the whole window when nothing is held", () => {
    // No rows at all — the empty morning. The first ask is the window itself,
    // and it stays askable: rows may appear at any minute.
    expect(dueRefresh([], TODAY, at(10), NEVER)).toEqual({
      from: MIDNIGHT,
      to: NEXT_MIDNIGHT,
    });
  });

  it("asks from the last bucket's START, so the partial bucket is re-answered", () => {
    // The newest bucket is still running when it is first fetched, so its
    // average is over a fraction of a minute. Asking from its END would freeze
    // that fraction into the chart forever.
    expect(dueRefresh([row(0), row(1), row(2)], TODAY, at(5), NEVER)).toEqual({
      from: new Date(MIDNIGHT.getTime() + 2 * MINUTE),
      to: NEXT_MIDNIGHT,
    });
  });

  it("asks for nothing until the clock passes the minute already synced", () => {
    // THE FIRST-RUN GATE. The card's refresh effect runs as soon as the initial
    // fetch lands, on the very minute that fetch covered — and a request there
    // is a second full ask per card the moment the page opens.
    const rows = [row(0), row(1)];
    expect(dueRefresh(rows, TODAY, at(5), at(5))).toBeNull();
    expect(dueRefresh(rows, TODAY, at(5), at(6))).toBeNull();
    expect(dueRefresh(rows, TODAY, at(6), at(5))).not.toBeNull();
  });

  it("asks for nothing while the held rows already reach the ticking bucket", () => {
    // THE REFETCH GUARD. This is asked once a minute of ~60 cards; a window
    // already up to date must produce no request at all, or the page asks sixty
    // times a minute for rows it has.
    expect(dueRefresh([row(0), row(5)], TODAY, at(5, 42), NEVER)).toBeNull();
  });

  it("asks again as soon as the minute turns", () => {
    expect(dueRefresh([row(5)], TODAY, at(6), NEVER)).toEqual({
      from: new Date(MIDNIGHT.getTime() + 5 * MINUTE),
      to: NEXT_MIDNIGHT,
    });
  });

  it("asks for nothing when the held rows run past the tick", () => {
    // A backfill, a clock stepping backwards, or a fixture that answers with
    // the whole window: the rows are ahead of the clock and there is nothing to
    // add.
    expect(dueRefresh([row(600)], TODAY, at(5), NEVER)).toBeNull();
  });

  it("asks for nothing once the window has closed behind the rows", () => {
    // Past the right edge there is no window left to ask for — an empty
    // `[from, to)` the server would answer with nothing.
    const closed = {
      from: MIDNIGHT,
      to: new Date(MIDNIGHT.getTime() + MINUTE),
      bucket: "minute" as const,
    };
    expect(dueRefresh([row(5)], closed, at(9), NEVER)).toBeNull();
  });

  it("asks at the width of the bucket it is given, not always the minute", () => {
    // An hourly window's rows are up to date for the whole hour they are in.
    const hourly = { from: MIDNIGHT, to: NEXT_MIDNIGHT, bucket: "hour" as const };
    const rows = [{ ...row(0), time: MIDNIGHT.toISOString() }];
    expect(dueRefresh(rows, hourly, at(59), NEVER)).toBeNull();
    expect(dueRefresh(rows, hourly, at(61), NEVER)).toEqual({
      from: MIDNIGHT,
      to: NEXT_MIDNIGHT,
    });
  });
});

describe("mergeRollup", () => {
  it("appends the delta after what is held", () => {
    const merged = mergeRollup([row(0), row(1)], [row(2), row(3)]);
    expect(merged.map((r) => r.time)).toEqual([row(0), row(1), row(2), row(3)].map((r) => r.time));
  });

  it("lets the newer answer win the bucket both cover", () => {
    // The partial bucket, re-answered. A concat would draw it twice.
    const merged = mergeRollup([row(0), row(1, 10)], [row(1, 90), row(2)]);
    expect(merged).toHaveLength(3);
    expect(merged[1]!.avg).toBe(90);
  });

  it("keeps the rows ascending even when the delta arrives out of order", () => {
    const merged = mergeRollup([row(5)], [row(2), row(9), row(7)]);
    expect(merged.map((r) => r.time)).toEqual([row(2), row(5), row(7), row(9)].map((r) => r.time));
  });

  it("hands back what is held for an empty delta, and the delta for empty held", () => {
    expect(mergeRollup([row(0)], []).map((r) => r.time)).toEqual([row(0).time]);
    expect(mergeRollup([], [row(0)]).map((r) => r.time)).toEqual([row(0).time]);
    expect(mergeRollup([], [])).toEqual([]);
  });
});

describe("rollupPoints", () => {
  it("parses each row's time into the date the chart plots", () => {
    const points = rollupPoints([row(0, 42)]);
    expect(points).toEqual([{ date: MIDNIGHT, avg: 42, min: 32, max: 52 }]);
  });

  it("is empty for no rows", () => {
    expect(rollupPoints([])).toEqual([]);
  });
});

describe("liveTailPoints — the frames spliced after the last rollup bucket", () => {
  /** Ten minutes of 1 Hz samples, one every ten seconds to keep the fixture small. */
  function feed(fromSeconds: number, toSeconds: number, v = 500): LivePoint[] {
    const out: LivePoint[] = [];
    for (let s = fromSeconds; s <= toSeconds; s += 10) out.push(sample(s, v));
    return out;
  }

  it("starts one bucket past the last rollup row, never inside it", () => {
    // The rollup covers [00:00, 00:03); the buffer holds samples through
    // 00:05:30. Only 00:03 and 00:04 may be drawn — 00:02 is already a bar and
    // 00:05 is still running.
    const rows = [row(0), row(1), row(2)];
    const tail = liveTailPoints(feed(0, 330), rows, TODAY);
    expect(tail.map((p) => p.date)).toEqual([
      new Date(MIDNIGHT.getTime() + 3 * MINUTE),
      new Date(MIDNIGHT.getTime() + 4 * MINUTE),
    ]);
  });

  it("draws only CLOSED buckets, so the chart changes once a minute", () => {
    // The bucket the feed is currently inside would change its average on every
    // frame — at ~1 Hz across sixty cards that is a re-render per frame, which
    // is the cost the whole lazy-mount queue exists to avoid.
    const tail = liveTailPoints(feed(0, 95), [], TODAY);
    expect(tail).toHaveLength(1);
    expect(tail[0]!.date).toEqual(MIDNIGHT);
  });

  it("aggregates each bucket the way the rollup does — avg, min and max", () => {
    const points: LivePoint[] = [
      sample(0, 100),
      sample(20, 200),
      sample(40, 300),
      // Past the bucket's end, so 00:00 counts as closed.
      sample(60, 999),
      sample(70, 999),
    ];
    const tail = liveTailPoints(points, [], TODAY);
    expect(tail[0]).toEqual({ date: MIDNIGHT, avg: 200, min: 100, max: 300 });
  });

  it("is empty when the buffer is empty", () => {
    // The empty morning again: no rows, no frames, nothing to splice.
    expect(liveTailPoints([], [], TODAY)).toEqual([]);
  });

  it("is empty when every held row already runs past the buffer", () => {
    expect(liveTailPoints(feed(0, 300), [row(600)], TODAY)).toEqual([]);
  });

  it("drops frames before the window's left edge", () => {
    // A buffer that spans midnight: the samples from yesterday belong to
    // yesterday's window, whatever the RAM buffer still holds.
    const yesterday = [
      { t: MIDNIGHT.getTime() - 90_000, v: 1 },
      { t: MIDNIGHT.getTime() - 30_000, v: 1 },
    ];
    const tail = liveTailPoints([...yesterday, ...feed(0, 95)], [], TODAY);
    expect(tail.map((p) => p.date)).toEqual([MIDNIGHT]);
  });

  it("drops frames past the window's right edge", () => {
    // Crossing midnight with the page left open: the reader is still on
    // yesterday's window and today's frames must not extend its axis.
    const window = {
      from: MIDNIGHT,
      to: new Date(MIDNIGHT.getTime() + 3 * MINUTE),
      bucket: "minute" as const,
    };
    const tail = liveTailPoints(feed(0, 400), [], window);
    expect(tail.map((p) => p.date)).toEqual([
      MIDNIGHT,
      new Date(MIDNIGHT.getTime() + MINUTE),
      new Date(MIDNIGHT.getTime() + 2 * MINUTE),
    ]);
  });

  it("groups on the bucket it is given, not always the minute", () => {
    const hourly = { from: MIDNIGHT, to: NEXT_MIDNIGHT, bucket: "hour" as const };
    const points = [sample(0, 10), sample(1800, 30), sample(3600, 50), sample(7300, 70)];
    const tail = liveTailPoints(points, [], hourly);
    expect(tail).toEqual([
      { date: MIDNIGHT, avg: 20, min: 10, max: 30 },
      { date: new Date(MIDNIGHT.getTime() + 3_600_000), avg: 50, min: 50, max: 50 },
    ]);
  });
});

describe("fetchWindow", () => {
  it("keeps the three fields the appending functions read, and nothing else", () => {
    const range = {
      from: new Date("2026-09-10T00:00:00.000Z"),
      to: new Date("2026-09-11T00:00:00.000Z"),
      bucket: "minute" as const,
      live: true,
      label: "Today",
    };
    expect(fetchWindow(range)).toEqual({ from: range.from, to: range.to, bucket: "minute" });
  });
});
