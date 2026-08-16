/**
 * The live metrics feed's mechanism: the per-metric ring buffers, and the lease
 * that keeps them fed.
 *
 * The store itself is a rune shell and cannot be exercised under `bun test`
 * (see `apps/web/TESTING.md`), so everything here that can be wrong — the window
 * and cap trim, the backfill's downsampling, and above all the *order* of
 * backfill against the topic's first frames — is plain TS on this side of the
 * split. The shell injects its `SvelteMap`, the bus lease and the HTTP fetch.
 */

import type { LivePoint, LiveSample } from "./types";

/** Trailing time window kept per metric for live sparklines. */
export const WINDOW_MS = 5 * 60 * 1000;

/** Hard per-metric point cap so a faster-than-1 Hz feed can't grow unbounded. */
// fallow-ignore-next-line unused-export -- the cap is a documented boundary; its test asserts on it
export const MAX_POINTS = 5000;

/** One row of the `/api/history/recent` backfill. */
export interface HistoryRow {
  metric: string;
  time: string;
  value: number;
}

/**
 * Where the buffers live. The store passes a `SvelteMap` (a plain `Map` in
 * `$state` is not reactive on get/set, so sparklines would not repaint); a test
 * passes a plain `Map`.
 */
export interface SeriesSink {
  get(key: string): LivePoint[] | undefined;
  set(key: string, points: LivePoint[]): void;
}

/**
 * Index of the first point still inside the trailing window, also enforcing the
 * hard cap so a buffer can never grow past {@link MAX_POINTS}.
 */
function firstLiveIndex(points: LivePoint[], cutoff: number): number {
  let start = 0;
  while (start < points.length && points[start]!.t < cutoff) start++;
  if (points.length - start >= MAX_POINTS) return points.length - MAX_POINTS + 1;
  return start;
}

/** Group raw history rows into per-metric point lists, in row order. */
function groupRows(rows: readonly HistoryRow[]): Map<string, LivePoint[]> {
  const byMetric = new Map<string, LivePoint[]>();
  for (const row of rows) {
    const points = byMetric.get(row.metric) ?? [];
    points.push({ t: new Date(row.time).getTime(), v: row.value });
    byMetric.set(row.metric, points);
  }
  return byMetric;
}

/**
 * Collapse the backfill to ~1 point/second so it matches the live stream's
 * density. The raw table can hold denser-than-1 Hz rows, which would make a
 * reloaded sparkline look far more compressed than one built live. Points are
 * ascending; keep the last sample in each 1-second bucket.
 */
function downsampleToHz(points: LivePoint[]): LivePoint[] {
  const out: LivePoint[] = [];
  let bucket = Number.NaN;
  for (const p of points) {
    const b = Math.floor(p.t / 1000);
    if (b === bucket) out[out.length - 1] = p;
    else {
      out.push(p);
      bucket = b;
    }
  }
  return out;
}

/** Keep points within the trailing window, bounded by the hard cap. */
function trim(points: LivePoint[]): LivePoint[] {
  const cutoff = (points.at(-1)?.t ?? 0) - WINDOW_MS;
  const windowed = points.filter((p) => p.t >= cutoff);
  return windowed.length > MAX_POINTS ? windowed.slice(-MAX_POINTS) : windowed;
}

/** The per-metric ring buffers the KPI sparklines draw. */
export class LiveSeries {
  #sink: SeriesSink;

  constructor(sink: SeriesSink) {
    this.#sink = sink;
  }

  /** Fold one live sample in, one buffer per metric it carries. */
  // fallow-ignore-next-line unused-class-member -- called as `this.#live.appendSample()` from the store; calls through a private-field receiver aren't traced
  appendSample(sample: LiveSample): void {
    const t = new Date(sample.time).getTime();
    const cutoff = t - WINDOW_MS;
    for (const [key, v] of Object.entries(sample.metrics)) {
      this.#append(key, { t, v }, cutoff);
    }
  }

  /**
   * Replace the buffers with the newest history rows. A replace, not a merge:
   * this runs before the first frames and again on every resume, and its job is
   * precisely to make the buffers jump to now rather than continue a stale line.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#live.seedRows()` from the store; calls through a private-field receiver aren't traced
  seedRows(rows: readonly HistoryRow[]): void {
    for (const [key, points] of groupRows(rows)) {
      // Rows arrive newest-first.
      points.sort((a, b) => a.t - b.t);
      this.#sink.set(key, trim(downsampleToHz(points)));
    }
  }

  /**
   * Append one metric's new sample and drop what fell out of the window. One copy
   * per metric per tick (new reference so consumers re-render): slice off expired
   * points from the front, then append. At a 1 Hz feed this runs every second for
   * every metric, so the old spread + filter pair (two full copies each) was the
   * main source of GC pressure — collection pauses showed up as animation hiccups.
   */
  #append(key: string, point: LivePoint, cutoff: number): void {
    const prev = this.#sink.get(key) ?? [];
    const next = prev.slice(firstLiveIndex(prev, cutoff));
    next.push(point);
    this.#sink.set(key, next);
  }
}

export interface MetricsFeedDeps {
  /** Seed the buffers from history. Resolves once they hold the newest rows. */
  backfill(): Promise<void>;
  /** Take the `metrics` topic lease off the bus; the return value gives it back. */
  subscribe(on: (sample: LiveSample) => void): () => void;
  /** One live frame, already past the visibility gate. */
  onSample(sample: LiveSample): void;
}

/**
 * The metrics topic lease, plus the two things the bus deliberately does not do
 * for this feed.
 *
 * **Backfill ordering.** `metrics` is the one topic with no server-side backfill
 * on subscribe — the sparkline history is rows in the database, not a snapshot
 * the socket holds. So the fetch stays, and it must *complete before* the first
 * frame is applied: a fetch landing after live points would replace the buffer
 * with rows that do not contain them. Hence subscribe-after-await, and hence the
 * generation counter — a lease dropped, or a tab hidden, mid-fetch abandons the
 * continuation instead of opening a stream nobody asked for.
 *
 * **Visibility.** A hidden tab stops *consuming*, but keeps the topic. Frames
 * cost nothing to drop, whereas giving the topic back would make the next frame
 * after a long hide read as one enormous poll interval to the bus's cadence
 * estimate — the animation clock would stretch to minutes. Coming back re-runs
 * the backfill, so the buffers jump to the newest data instead of resuming a
 * line with a hole in it.
 */
export class MetricsFeed {
  #deps: MetricsFeedDeps;
  #release: (() => void) | null = null;
  #leased = false;
  #hidden = false;
  /** Frames only land between a completed backfill and the next hide. */
  #consuming = false;
  /** Bumped by anything that invalidates an in-flight backfill. */
  #generation = 0;

  constructor(deps: MetricsFeedDeps) {
    this.#deps = deps;
  }

  /** Take the metrics lease; the disposer gives it back. Idempotent per lease. */
  // fallow-ignore-next-line unused-class-member -- called as `this.#feed.lease()` from the store; calls through a private-field receiver aren't traced
  lease(): () => void {
    this.#leased = true;
    void this.#resume();
    return () => {
      this.#leased = false;
      this.#stop();
      this.#release?.();
      this.#release = null;
    };
  }

  /** Tab visibility changed; the shell owns the DOM listener. */
  // fallow-ignore-next-line unused-class-member -- called as `this.#feed.setHidden()` from the store; calls through a private-field receiver aren't traced
  setHidden(hidden: boolean): void {
    if (hidden === this.#hidden) return;
    this.#hidden = hidden;
    if (hidden) this.#stop();
    else void this.#resume();
  }

  /** Stop consuming and abandon whatever backfill is in flight. */
  #stop(): void {
    this.#consuming = false;
    this.#generation++;
  }

  async #resume(): Promise<void> {
    if (!this.#leased || this.#hidden) return;
    const generation = ++this.#generation;
    // A failed backfill is a gap in the sparklines, not a reason to stay
    // offline: the live numbers are the page, the history behind them is a
    // nicety. Swallowing the rejection here also keeps `void this.#resume()`
    // in `lease()` from leaking an unhandled rejection.
    await this.#deps.backfill().catch(() => {});
    // A dispose or a hide overtook the fetch: its rows are already stale and the
    // stream it would open has no reader.
    if (generation !== this.#generation) return;
    this.#consuming = true;
    // The topic is taken once and kept across hides — see the class comment.
    this.#release ??= this.#deps.subscribe((sample) => this.#apply(sample));
  }

  #apply(sample: LiveSample): void {
    if (this.#consuming) this.#deps.onSample(sample);
  }
}
