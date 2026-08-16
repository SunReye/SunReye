/**
 * The log viewer's buffer arithmetic, as plain values.
 *
 * The store around this owns nothing but `$state` and the bus lease; everything
 * that can be wrong — the pause hand-off, the cap, and the replay dedupe below
 * — lives here, because runes do not run under `bun test` (see
 * `apps/web/TESTING.md`).
 */

import type { LogEntry } from "@SunReye/contracts/logs";

/**
 * How many lines to keep in the viewer. The server retains a smaller ring
 * buffer for the subscribe-time backfill; this is the client-side cap on the
 * live feed so a long-lived panel can't grow without bound.
 */
// fallow-ignore-next-line unused-export -- the cap is a documented boundary; its test asserts on it
export const MAX_LINES = 2000;

/** Everything the viewer has received: what is on screen, and what pause is withholding. */
export interface LogFeed {
  /** Visible log lines, oldest first. */
  lines: LogEntry[];
  /** Lines received while paused, awaiting resume — also oldest first. */
  held: LogEntry[];
}

/** Same line, by every field that reaches the wire. */
function sameEntry(a: LogEntry, b: LogEntry): boolean {
  return (
    a.time === b.time && a.level === b.level && a.category === b.category && a.message === b.message
  );
}

function tailMatches(existing: LogEntry[], batch: LogEntry[], overlap: number): boolean {
  const start = existing.length - overlap;
  for (let i = 0; i < overlap; i++) {
    if (!sameEntry(existing[start + i]!, batch[i]!)) return false;
  }
  return true;
}

/**
 * Drop the part of a batch we are already showing.
 *
 * The server backfills its ring buffer on every `sub`, and the bus re-sends
 * `sub` for each topic after a reconnect — so a dropped connection replays
 * lines that are already on screen, in a batch indistinguishable from live
 * traffic. There is no id on a {@link LogEntry} to dedupe by, but a replay is
 * always a *contiguous window* ending at the server's newest line, so the
 * honest test is a suffix/prefix overlap: if the head of the batch is the tail
 * of what we hold, that head is the replay and only the remainder is new.
 *
 * Live traffic is strictly newer than the last line we hold, which skips the
 * scan entirely — the search only runs on the rare frame that could overlap.
 * The cost of that precision: two identical lines emitted in the same
 * millisecond collapse to one. A duplicate timestamp is far cheaper to lose
 * than a full screen repainted on every reconnect.
 */
function dropReplayedHead(existing: LogEntry[], batch: LogEntry[]): LogEntry[] {
  const last = existing.at(-1);
  if (!last || batch.length === 0) return batch;
  if (batch[0]!.time > last.time) return batch;
  for (let overlap = Math.min(existing.length, batch.length); overlap > 0; overlap--) {
    if (tailMatches(existing, batch, overlap)) return batch.slice(overlap);
  }
  return batch;
}

function capped(lines: LogEntry[]): LogEntry[] {
  return lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines;
}

/**
 * Fold one wire batch into the feed. Returns the *same* feed when the batch
 * adds nothing, so a replay costs the viewer no re-render.
 */
export function ingestBatch(feed: LogFeed, batch: LogEntry[], paused: boolean): LogFeed {
  if (batch.length === 0) return feed;
  // Paused lines are already received, so they count as "shown" for the dedupe:
  // a reconnect while paused must not queue up a second copy of them.
  const received = feed.held.length > 0 ? [...feed.lines, ...feed.held] : feed.lines;
  const fresh = dropReplayedHead(received, batch);
  if (fresh.length === 0) return feed;
  if (paused) return { lines: feed.lines, held: capped(feed.held.concat(fresh)) };
  return { lines: capped(feed.lines.concat(fresh)), held: feed.held };
}

/** Resume: show what pause withheld, in arrival order. */
export function releaseHeld(feed: LogFeed): LogFeed {
  if (feed.held.length === 0) return feed;
  return { lines: capped(feed.lines.concat(feed.held)), held: [] };
}
