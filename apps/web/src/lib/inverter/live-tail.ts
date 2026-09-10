/**
 * Appending to a window whose right edge is the future.
 *
 * The Day tab standing on today is `[00:00, next midnight)` with `live: true`
 * (see {@link historyPeriodRange}), and `live` means exactly one thing here:
 * the window is still filling in, so the chart has to keep growing towards the
 * clock. It does NOT mean "draw the five-minute RAM buffer instead", which is
 * what it used to mean and what made the Day tab show the last two minutes of a
 * day it claimed to be showing.
 *
 * Growing it takes two mechanisms, and both live in this file because both are
 * pure functions over rows and frames — the component that calls them owns only
 * the timer and the fetch:
 *
 *   DELTA   {@link dueRefresh} names the window the card still needs, from
 *           the start of the newest bucket it holds. On a minute tick that is
 *           one small query, not the whole day again — and it is null when the
 *           held rows already reach the ticking bucket, which is what keeps
 *           ~60 cards from asking sixty times a minute for rows they have.
 *   FRAMES  {@link liveTailPoints} buckets the live buffer the same way the
 *           server's minute aggregate does and hands back the buckets AFTER the
 *           last rollup one, so the line reaches the present between deltas
 *           even while the continuous aggregate lags.
 *
 * Only CLOSED buckets are spliced. The bucket the feed is currently inside
 * changes its average on every frame, and a ~1 Hz identity change on the data
 * of sixty LayerCharts is the per-frame cost the mount queue exists to avoid —
 * the running minute is what the card's live readout above the plot is for.
 */

import type { RollupBucket } from "./ranges";
import type { LivePoint } from "./types";

/** One row of `/api/history/rollup`, as `queryRollup` serves it. */
export interface RollupRow {
  time: string;
  avg: number;
  min: number;
  max: number;
}

/** One point a history chart plots. */
export interface HistoryPoint {
  date: Date;
  avg: number;
  min: number;
  max: number;
}

/** The window a chart is filling in, with the granularity it fetched. */
export interface LiveWindow {
  from: Date;
  to: Date;
  bucket: RollupBucket;
}

/**
 * Width of each rollup bucket, for grouping live frames the way the server
 * grouped the rows they are spliced onto.
 *
 * `day` is a flat 86_400_000 and is therefore wrong twice a year — deliberately.
 * These widths only ever group LIVE frames, and a live window is only ever the
 * current day at minute granularity ({@link historyPeriodRange}); the calendar
 * boundaries a DST day actually needs are `periodWindow`'s job, which is where
 * the window itself comes from.
 */
const BUCKET_MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const satisfies Record<RollupBucket, number>;

/** `t` floored to the start of the bucket of `width` holding it. */
const bucketFloor = (t: number, width: number): number => Math.floor(t / width) * width;

/** Start of the newest bucket in `rows` — null when nothing is held yet. */
function lastBucketStart(rows: readonly RollupRow[]): Date | null {
  const last = rows.at(-1);
  return last === undefined ? null : new Date(last.time);
}

/**
 * Exclusive END of the newest bucket in `rows` — the first instant live frames
 * may be drawn at, since the bucket before it is already a mark on the chart.
 */
function lastBucketEnd(rows: readonly RollupRow[], bucket: RollupBucket): Date | null {
  const start = lastBucketStart(rows);
  return start === null ? null : new Date(start.getTime() + BUCKET_MS[bucket]);
}

/**
 * The delta a still-running window needs at `tick`, or null when it needs none.
 *
 * From the newest held bucket's START, not its end: that bucket was fetched
 * while it was still running, so its average is over a fraction of the period
 * and has to be re-answered rather than left frozen. `mergeRollup` is what
 * makes re-answering it cheap.
 *
 * Null is the important half, and there are three ways to reach it — the clock
 * has not moved past the minute the rows were last brought up to
 * (`syncedTickMs`), the rows already cover the bucket the clock is in, or the
 * window has closed behind them. This is asked once a minute of every mounted
 * card, of which there are ~60, so a window already up to date must produce NO
 * request: otherwise the fix for a chart showing too little becomes a request
 * storm, the failure this page has already shipped once (PR #60).
 *
 * Takes the two clock values as milliseconds rather than reading a clock,
 * because "which minute are we in" is the caller's dependency to declare — a
 * chart that re-derives its own window from a ticking clock is that same loop.
 */
export function dueRefresh(
  rows: readonly RollupRow[],
  window: LiveWindow,
  tickMs: number,
  syncedTickMs: number,
): { from: Date; to: Date } | null {
  if (tickMs <= syncedTickMs) return null;
  const start = lastBucketStart(rows);
  const width = BUCKET_MS[window.bucket];
  // Already covering the bucket the clock is in (or running past it — a
  // backfill, or a fixture that answers with the whole window).
  if (start !== null && start.getTime() >= bucketFloor(tickMs, width)) return null;
  const from = start ?? window.from;
  return from.getTime() >= window.to.getTime() ? null : { from, to: window.to };
}

/**
 * The rows held, with a delta merged in: same bucket, newer answer wins.
 *
 * Keyed on the row's own `time`, so the partial bucket both answers cover is
 * replaced rather than drawn twice — a plain concat puts two marks on one
 * minute, the second of them the stale fraction.
 */
export function mergeRollup(held: readonly RollupRow[], delta: readonly RollupRow[]): RollupRow[] {
  const byTime = new Map(held.map((row) => [row.time, row]));
  for (const row of delta) byTime.set(row.time, row);
  return [...byTime.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** Rollup rows as chart points. */
export function rollupPoints(rows: readonly RollupRow[]): HistoryPoint[] {
  return rows.map((row) => ({
    date: new Date(row.time),
    avg: row.avg,
    min: row.min,
    max: row.max,
  }));
}

/**
 * The live buffer as chart points, for the buckets `rows` does not cover yet.
 *
 * Three filters, each one a boundary that has been wrong somewhere in this app
 * before: a bucket already covered by a fetched row (drawn twice), a bucket
 * outside `[from, to)` (a buffer spanning midnight extending yesterday's axis
 * into today), and the bucket the feed is currently inside (a per-frame
 * identity change on sixty charts).
 */
export function liveTailPoints(
  live: readonly LivePoint[],
  rows: readonly RollupRow[],
  window: LiveWindow,
): HistoryPoint[] {
  const newest = live.at(-1)?.t;
  if (newest === undefined) return [];
  const width = BUCKET_MS[window.bucket];
  const after = (lastBucketEnd(rows, window.bucket) ?? window.from).getTime();
  const until = window.to.getTime();

  const buckets = new Map<number, { sum: number; count: number; min: number; max: number }>();
  for (const point of live) {
    const start = bucketFloor(point.t, width);
    if (start < after || start >= until) continue;
    // Still running: its average is not settled yet.
    if (start + width > newest) continue;
    const held = buckets.get(start);
    if (held === undefined) {
      buckets.set(start, { sum: point.v, count: 1, min: point.v, max: point.v });
      continue;
    }
    held.sum += point.v;
    held.count += 1;
    held.min = Math.min(held.min, point.v);
    held.max = Math.max(held.max, point.v);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, agg]) => ({
      date: new Date(start),
      avg: agg.sum / agg.count,
      min: agg.min,
      max: agg.max,
    }));
}
