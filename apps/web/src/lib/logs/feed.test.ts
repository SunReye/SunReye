import { describe, expect, test } from "bun:test";
import type { LogEntry } from "@SunReye/contracts/logs";
import { MAX_LINES, type LogFeed, ingestBatch, releaseHeld } from "./feed";

function entry(time: number, message: string): LogEntry {
  return { time, level: "info", category: "server", message };
}

const empty: LogFeed = { lines: [], held: [] };

describe("ingestBatch", () => {
  test("appends a live batch, oldest first", () => {
    const first = ingestBatch(empty, [entry(1, "a"), entry(2, "b")], false);
    const second = ingestBatch(first, [entry(3, "c")], false);
    expect(second.lines.map((l) => l.message)).toEqual(["a", "b", "c"]);
    expect(second.held).toEqual([]);
  });

  test("an empty batch changes nothing and keeps the same feed", () => {
    const feed = ingestBatch(empty, [entry(1, "a")], false);
    expect(ingestBatch(feed, [], false)).toBe(feed);
  });

  test("holds lines while paused instead of showing them", () => {
    const live = ingestBatch(empty, [entry(1, "a")], false);
    const paused = ingestBatch(live, [entry(2, "b"), entry(3, "c")], true);
    expect(paused.lines.map((l) => l.message)).toEqual(["a"]);
    expect(paused.held.map((l) => l.message)).toEqual(["b", "c"]);
  });

  test("releaseHeld folds the held lines back in, in order", () => {
    const live = ingestBatch(empty, [entry(1, "a")], false);
    const paused = ingestBatch(live, [entry(2, "b")], true);
    const resumed = releaseHeld(paused);
    expect(resumed.lines.map((l) => l.message)).toEqual(["a", "b"]);
    expect(resumed.held).toEqual([]);
  });

  test("releaseHeld with nothing held keeps the same feed", () => {
    const live = ingestBatch(empty, [entry(1, "a")], false);
    expect(releaseHeld(live)).toBe(live);
  });

  test("caps the visible buffer at MAX_LINES, dropping the oldest", () => {
    const batch = Array.from({ length: MAX_LINES + 10 }, (_, i) => entry(i + 1, `line-${i}`));
    const feed = ingestBatch(empty, batch, false);
    expect(feed.lines).toHaveLength(MAX_LINES);
    expect(feed.lines[0]?.message).toBe("line-10");
  });

  test("caps the held buffer at MAX_LINES too", () => {
    const batch = Array.from({ length: MAX_LINES + 5 }, (_, i) => entry(i + 1, `line-${i}`));
    const feed = ingestBatch(empty, batch, true);
    expect(feed.held).toHaveLength(MAX_LINES);
    expect(feed.held[0]?.message).toBe("line-5");
  });
});

describe("reconnect replay", () => {
  // The bug this dedupe exists for: the server backfills its ring buffer on
  // every (re)subscribe, and a replayed batch is byte-identical to live
  // traffic. Without the overlap check, one reconnect painted every retained
  // line a second time.
  test("a ring-buffer replay after a reconnect does not duplicate lines already shown", () => {
    const live = ingestBatch(empty, [entry(1, "a"), entry(2, "b"), entry(3, "c")], false);
    const replayed = ingestBatch(live, [entry(1, "a"), entry(2, "b"), entry(3, "c")], false);
    expect(replayed.lines.map((l) => l.message)).toEqual(["a", "b", "c"]);
  });

  test("keeps the lines the replay adds beyond what was already shown", () => {
    const live = ingestBatch(empty, [entry(1, "a"), entry(2, "b")], false);
    const replayed = ingestBatch(live, [entry(1, "a"), entry(2, "b"), entry(3, "c")], false);
    expect(replayed.lines.map((l) => l.message)).toEqual(["a", "b", "c"]);
  });

  test("a replay whose ring starts after our oldest line still dedupes", () => {
    const live = ingestBatch(empty, [entry(1, "a"), entry(2, "b"), entry(3, "c")], false);
    // The server's ring only reaches back to "b".
    const replayed = ingestBatch(live, [entry(2, "b"), entry(3, "c"), entry(4, "d")], false);
    expect(replayed.lines.map((l) => l.message)).toEqual(["a", "b", "c", "d"]);
  });

  test("dedupes a replay against lines held while paused", () => {
    const live = ingestBatch(empty, [entry(1, "a")], false);
    const paused = ingestBatch(live, [entry(2, "b")], true);
    const replayed = ingestBatch(paused, [entry(1, "a"), entry(2, "b"), entry(3, "c")], true);
    expect(replayed.lines.map((l) => l.message)).toEqual(["a"]);
    expect(replayed.held.map((l) => l.message)).toEqual(["b", "c"]);
  });

  test("a repeated message at a later time is a real line, not a replay", () => {
    const live = ingestBatch(empty, [entry(1, "poll failed"), entry(2, "poll failed")], false);
    const next = ingestBatch(live, [entry(3, "poll failed")], false);
    expect(next.lines).toHaveLength(3);
  });

  test("two lines differing only in level are not treated as one", () => {
    const live = ingestBatch(empty, [entry(1, "same")], false);
    const next = ingestBatch(live, [{ ...entry(1, "same"), level: "error" }], false);
    expect(next.lines).toHaveLength(2);
  });

  test("a replay into an empty buffer is kept whole", () => {
    const feed = ingestBatch(empty, [entry(1, "a"), entry(2, "b")], false);
    expect(feed.lines).toHaveLength(2);
  });
});
