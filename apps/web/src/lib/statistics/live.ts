// Pure rules of the live statistics stream: which picked ranges are worth a
// socket at all, and how often a live push may trigger a refetch. Kept out of
// the store so both are testable without a WebSocket.

import type { CostRange } from "$lib/cost/ranges";
import { containsNow } from "$lib/time/period";

/**
 * Does the picked range include the present moment?
 *
 * The WINDOW answers, and nothing else does. This used to be an id set —
 * `{today, 7d, month, year}` — beside a `to > now` test, because those presets
 * clamped `to` at the instant they were resolved and stopped containing `now`
 * one tick later. Every window the page can pick now runs to a real boundary in
 * the future (a calendar period's exclusive end, the kept preset's end of today,
 * a custom range's midnight after the last picked day), so the set had nothing
 * left to rescue — and while it existed it was actively wrong in two directions:
 *
 *  - a stepped-back Month is still id `month`, so the set leased the feed for a
 *    window that can never change again and kept the server's periodic job
 *    running for nothing;
 *  - `to > now` alone says yes to a window that has not STARTED, which a custom
 *    range picked in the future is.
 *
 * `containsNow` is `[start, end)` in one place, shared with the navigator's live
 * pill and its dead forward arrow — so the pill, the arrow and the lease cannot
 * disagree about whether the reader is live.
 */
export function includesNow(range: CostRange, now: Date = new Date()): boolean {
  return containsNow({ start: range.from, end: range.to }, now);
}

/**
 * Floor between two live-triggered refetches of a wider window (ms). The stream
 * ticks every 15 s, but re-pricing a month costs far more than today's 24
 * buckets, so a wider range only revalidates on the minute.
 */
const REVALIDATE_MIN_MS = 60_000;

/** May a push at `now` trigger a refetch, given the previous one at `lastAt`? */
export function shouldRevalidate(
  lastAt: number | null,
  now: number,
  minMs: number = REVALIDATE_MIN_MS,
): boolean {
  return lastAt === null || now - lastAt >= minMs;
}

/**
 * How the page consumes pushes for the current range:
 * `today` patches the tiles from the payload, `window` treats a push as a
 * throttled invalidation of the range-wide fetches.
 */
export type LiveMode = "today" | "window";

/**
 * The mode a now-inclusive range consumes the stream in.
 *
 * `today` only for the DAY period holding `now`. The stream's `today` payload is
 * today's breakdown, so handing it to a range showing last Tuesday would
 * overwrite that day's totals with this one's — and `range.id` alone cannot tell
 * the two apart any more, because both are the Day tab and both are `"day"`.
 */
export function liveModeFor(range: CostRange, now: Date = new Date()): LiveMode {
  return range.id === "day" && includesNow(range, now) ? "today" : "window";
}
