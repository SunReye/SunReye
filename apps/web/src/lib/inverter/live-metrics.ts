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
// fallow-ignore-next-line unused-export -- the window is a documented boundary, and the same number decides the trim, the full-refetch width and the seed-vs-merge split; its tests state it once here rather than re-spelling 300_000 in each
export const WINDOW_MS = 5 * 60 * 1000;

/** Hard per-metric point cap so a faster-than-1 Hz feed can't grow unbounded. */
// fallow-ignore-next-line unused-export -- the cap is a documented boundary; its test asserts on it
export const MAX_POINTS = 5000;

/** One metric's compact series: `o` = offsets in steps from `t0`, `v` = values. */
export interface RecentSeries {
  o: number[];
  v: number[];
}

/**
 * The `/api/history/recent` payload. Timestamps are not repeated per sample —
 * point `i` of a series is at `t0 + o[i] * step * 1000` ms — and the metric name
 * is paid once per series. Mirrors `RecentBackfill` on the server.
 */
export interface RecentBackfill {
  t0: number;
  step: number;
  metrics: Record<string, RecentSeries>;
}

/**
 * Seconds of overlap a gap-resume asks for beyond the measured gap, so the rows
 * either side of the seam are re-stated and {@link LiveSeries.mergeBackfill}
 * replaces them instead of leaving a hole. Module-private: it is an ingredient
 * of {@link backfillSeconds}, which is the width callers actually ask for.
 */
const RESUME_OVERLAP_S = 2;

/**
 * Where the buffers live. The store passes a `SvelteMap` (a plain `Map` in
 * `$state` is not reactive on get/set, so sparklines would not repaint); a test
 * passes a plain `Map`.
 */
export interface SeriesSink {
  get(key: string): LivePoint[] | undefined;
  set(key: string, points: LivePoint[]): void;
  keys(): Iterable<string>;
}

/**
 * Expand the compact payload back into absolute-time points, one list per
 * metric. Every guard here is a defence against a malformed payload turning
 * into NaN timestamps, which draw as an invisible line rather than an error:
 * a non-positive `step` would collapse every point onto `t0`, and a length
 * mismatch between `o` and `v` would emit `undefined` values.
 *
 * A metric present with an empty series stays a present key holding an empty
 * array — {@link LiveSeries.seedBackfill} relies on that to clear a stale line.
 *
 * Module-private: the buffers are the product, so this is exercised through the
 * two paths that spend it rather than on its own.
 */
function expandBackfill(payload: RecentBackfill | null | undefined): Map<string, LivePoint[]> {
  const out = new Map<string, LivePoint[]>();
  if (!payload || !Number.isFinite(payload.t0)) return out;
  const stepMs = payload.step * 1000;
  if (!Number.isFinite(stepMs) || stepMs <= 0) return out;
  for (const [key, series] of Object.entries(payload.metrics ?? {})) {
    out.set(key, expandSeries(series, payload.t0, stepMs));
  }
  return out;
}

/**
 * One metric's offsets and values as absolute-time points.
 *
 * Split out of {@link expandBackfill} to keep both under the repo's complexity
 * ceiling: the guards against a malformed payload are branches, and carrying
 * the whole-payload ones and the per-series ones in one function put it over.
 *
 * Truncating to the SHORTER of the two arrays is the length-mismatch defence —
 * the pairing is positional, so a longer `o` has no value to pair with and a
 * longer `v` has no time to sit at.
 */
function expandSeries(series: RecentSeries | undefined, t0: number, stepMs: number): LivePoint[] {
  const offsets = series?.o ?? [];
  const values = series?.v ?? [];
  const count = Math.min(offsets.length, values.length);
  const points: LivePoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({ t: t0 + offsets[i]! * stepMs, v: values[i]! });
  }
  return points;
}

/**
 * How wide the next backfill request has to be, given the newest point already
 * held. A resume after a ten-second hide should cost ten seconds of rows, not
 * the whole five-minute window — that is by far the most frequent backfill.
 *
 * Boundaries that matter: nothing held (first load) and a gap at least as wide
 * as the window both mean a full refetch, because there is nothing left to
 * merge onto.
 *
 * **The two clocks.** `newestHeldMs` is SERVER-stamped — it comes from the WS
 * frame's `time`, written by the inverter runtime — while `nowMs` is the
 * BROWSER's. The server then turns the width back into `now − seconds` on its
 * own clock. So the subtraction below straddles two clocks, and a browser
 * running behind the server makes the measured gap zero or negative even when
 * real seconds are missing. Clamping that to 1 would ask for one second and
 * leave the rest of the hole unfilled — which draws as a straight line, never as
 * an error. A non-positive gap therefore means the clocks disagree and the
 * measurement is worthless: fall back to the full window, which is correct under
 * any skew and costs one extra fetch of rows we mostly have. (Cheaper than
 * having the server echo its own `now`, which would change the wire shape and
 * every caller of it, for a case this rare.)
 */
export function backfillSeconds(newestHeldMs: number | null, nowMs: number): number {
  const full = WINDOW_MS / 1000;
  if (newestHeldMs === null || !Number.isFinite(newestHeldMs)) return full;
  const gap = nowMs - newestHeldMs;
  if (!Number.isFinite(gap) || gap <= 0 || gap >= WINDOW_MS) return full;
  return Math.ceil(gap / 1000) + RESUME_OVERLAP_S;
}

/**
 * Does a backfill of this width replace the buffers, or fold onto them?
 *
 * A full-width request is the whole truth about the window, so it seeds (and a
 * metric it omits is dead — {@link LiveSeries.seedBackfill} clears it). Anything
 * narrower only describes a gap and merges. The decision is made on the width we
 * ASKED for, never on what came back, so the two paths' absent-metric semantics
 * stay matched to the request.
 *
 * It lives here rather than inline in the store because it is the riskiest line
 * of the backfill path — inverted, it either blanks the dashboard or leaves a
 * permanently stale line — and inline in a rune shell it can only be tested by
 * copying it, which pins nothing.
 */
export function isFullBackfill(seconds: number): boolean {
  return seconds >= WINDOW_MS / 1000;
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
   * The newest timestamp held across every buffer, or null when nothing is held
   * yet. This is what sizes the next backfill request — see
   * {@link backfillSeconds}.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#live.newestHeldMs()` from the store; calls through a private-field receiver aren't traced
  newestHeldMs(): number | null {
    let newest: number | null = null;
    for (const key of this.#sink.keys()) {
      const last = this.#sink.get(key)?.at(-1);
      if (last && (newest === null || last.t > newest)) newest = last.t;
    }
    return newest;
  }

  /**
   * Replace the buffers from a FULL-window backfill. A replace, not a merge:
   * this runs before the first frames and on any resume wide enough that
   * merging buys nothing, and its job is precisely to make the buffers jump to
   * now rather than continue a stale line.
   *
   * A full backfill is the whole truth about the window, so a metric it does
   * not mention has no data and its buffer is cleared. The asymmetry against
   * {@link mergeBackfill} is deliberate and tested. The exception is a wholly
   * empty payload: that reads as "the server told us nothing", not "every metric
   * is dead", and wiping the page on one such answer is the worse failure.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#live.seedBackfill()` from the store; calls through a private-field receiver aren't traced
  seedBackfill(payload: RecentBackfill | null | undefined): void {
    const expanded = expandBackfill(payload);
    if (expanded.size === 0) return;
    for (const key of this.#sink.keys()) {
      if (!expanded.has(key)) this.#sink.set(key, []);
    }
    for (const [key, points] of expanded) this.#sink.set(key, trim(points));
  }

  /**
   * Fold a GAP backfill onto what is already held. Held points inside the span
   * the payload covers — `[first bucket, last bucket]` — are dropped rather than
   * interleaved, so the 2 s request overlap replaces the points it re-states
   * instead of duplicating them; a duplicate there is a visible vertical stutter
   * in the sparkline.
   *
   * The span's UPPER bound is load-bearing, not tidiness: `metrics_raw` lags the
   * live stream by up to `HISTORY_FLUSH_INTERVAL_MS`, so when the flush lag
   * exceeds the gap the payload stops short of the newest point already held.
   * Dropping everything at or after the FIRST bucket would delete held points
   * the payload never covers and nothing would replace them — the buffer's
   * newest point would jump backwards on every such resume.
   *
   * A metric absent from a partial payload KEEPS its points: the payload only
   * describes the gap, so silence means "nothing new in those seconds", not "no
   * data". Clearing here would blank half the dashboard on every tab switch.
   *
   * `trim` runs on this path too. Without it, a long run of short hide/show
   * cycles grows a buffer one merge at a time until it is past the cap.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#live.mergeBackfill()` from the store; calls through a private-field receiver aren't traced
  mergeBackfill(payload: RecentBackfill | null | undefined): void {
    for (const [key, points] of expandBackfill(payload)) {
      if (points.length === 0) continue;
      const from = points[0]!.t;
      const to = points.at(-1)!.t;
      const held = this.#sink.get(key) ?? [];
      const before = held.filter((p) => p.t < from);
      const after = held.filter((p) => p.t > to);
      this.#sink.set(key, trim(before.concat(points, after)));
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
