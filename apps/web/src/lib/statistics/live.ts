// Pure rules of the live statistics stream: which picked ranges are worth a
// socket at all, and how often a live push may trigger a refetch. Kept out of
// the store so both are testable without a WebSocket.

import type { CostRange } from "$lib/cost/ranges";

/**
 * Presets whose window runs up to "now", so a live push changes what they show.
 * `lastMonth` is deliberately absent: a closed window never moves, and leaving
 * a lease open for it would keep the server's 15 s job running for nothing.
 */
const NOW_INCLUSIVE_PRESETS = new Set(["today", "7d", "month", "year"]);

/**
 * Does the picked range include the present moment? Preset windows are resolved
 * once (their `to` is the wall clock at pick time and goes stale a second
 * later), so they answer by id; a custom range answers by its end boundary,
 * which is the exclusive midnight after the last picked day.
 */
export function includesNow(range: CostRange, now: Date = new Date()): boolean {
  return NOW_INCLUSIVE_PRESETS.has(range.id) || range.to.getTime() > now.getTime();
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

/** The mode a now-inclusive range consumes the stream in. */
export function liveModeFor(range: CostRange): LiveMode {
  return range.id === "today" ? "today" : "window";
}
