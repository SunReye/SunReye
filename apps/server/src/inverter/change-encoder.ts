/**
 * Change-only encoding of a metric's series: the biggest single lever on write
 * volume, and the one place the *shape* of stored history is decided.
 *
 * Measured on one device: 69.8 % of every row written was a byte-identical
 * repeat of the previous value. Storing changes instead of samples makes the
 * output **rate-independent** — the number of times a signal changes per day is
 * a property of the signal, not of the sampler — so a 1 Hz poll for control
 * quality costs the same history as a 30-second logger, and device count scales
 * the stream linearly while poll rate no longer does.
 *
 * ## What a row means after this
 *
 * A row is no longer "a sample at an instant". It is **an interval**: `value`
 * was held for `durMs` starting at `time`. That is what lets the continuous
 * aggregates compute a *time-weighted* mean (`Σ value·dur / Σ dur`); a plain
 * `avg(value)` over a change-only series is badly wrong on exactly the signals
 * that matter most — a mostly-idle one with short excursions contributes one row
 * for the idle hour and hundreds for the spike.
 *
 * ## Two properties this file exists to guarantee
 *
 * **1. The deadband compares against the last value STORED, never the last
 * sample.** A per-sample comparison looks cheaper on a row count and is
 * silently, unboundedly wrong: a signal drifting 0.9 V per sample never trips a
 * 1 V per-sample threshold, so it is never stored and the series wanders
 * arbitrarily far from reality while reporting nothing. Comparing against the
 * carried-forward stored value makes the error bound *equal* to the threshold by
 * construction — which is the property that makes a deadband safe to document:
 * "1 V deadband" then means "the stored series is never wrong by more than 1 V".
 *
 * **2. No stored interval crosses a bucket boundary.** Every open interval is
 * closed at the end of its own bucket and reopened, so `Σ dur` within a bucket
 * is the bucket width and the weighted mean is *exact* rather than
 * approximately weighted. This is also the heartbeat: a dead-flat metric emits
 * one row per bucket, so there is no separate heartbeat timer to arm, to get
 * wrong across midnight, or to test across a DST change (bucket alignment is
 * epoch-based, so a local-time offset never enters into it).
 *
 * ## The cost, stated plainly
 *
 * A row is emitted when its interval *closes*, so it is written up to one bucket
 * width late. History lags by that much; live data does not exist here at all
 * (it is served from memory over WebSocket, and the control engine reads the
 * live sample), so nothing user-facing waits on it.
 */

/** One encoded interval: `value` held for `durMs`, starting at `time`. */
export interface EncodedRow {
  time: Date;
  value: number;
  /** Milliseconds the value was held. Never 0, never spans a bucket boundary. */
  durMs: number;
}

export interface ChangeEncoderDeps {
  /**
   * The change threshold for a metric, in the metric's own unit — `undefined`
   * meaning "store every change", which is the default and the only safe one.
   * Counters and enums must always resolve to `undefined`: a threshold makes a
   * counter lag, and on an enum it can swallow a state transition.
   */
  deadbandFor(metric: string): number | undefined;
  /**
   * Bucket width every interval is aligned to, ms. Must divide every coarser
   * aggregate bucket — one minute divides the hour and the day, which is why the
   * finest rollup tier is the right choice. Defaults to 60 000.
   */
  bucketMs?: number;
  /**
   * How long a silence may be before it stops being a held value and becomes a
   * gap in the record. Past this, the next reading starts a fresh interval
   * rather than extending the previous value across the silence — "unchanged"
   * and "unknown" must not become the same thing in the history. Must be less
   * than {@link bucketMs}. Defaults to 15 000.
   */
  gapMs?: number;
}

/** A row the encoder produced, tagged with the metric it belongs to. */
export interface TaggedRow extends EncodedRow {
  metric: string;
}

export interface ChangeEncoder {
  /**
   * Feed one reading. Returns the rows it *closes* — usually none, one when a
   * change or a bucket boundary closes the open interval, two when a boundary
   * and a change fall between the same pair of readings.
   */
  observe(metric: string, at: Date, value: number): EncodedRow[];
  /**
   * Close every open interval at `at` (shutdown, a source swap, a profile
   * change). Without this the currently-held value of every metric is lost, and
   * on a restart loop that is every metric, every time.
   */
  close(at: Date): TaggedRow[];
  /** Metrics with an interval open right now — the memory this holds. */
  readonly openCount: number;
}

/** The interval currently open for one metric. */
interface Open {
  /** Start of the interval, always inside a single bucket. */
  startMs: number;
  /** The value held since {@link startMs} — the deadband's reference. */
  value: number;
}

/** Whether a reading differs enough from the stored reference to be worth a row. */
function exceeds(value: number, reference: number, deadband: number | undefined): boolean {
  if (value === reference) return false;
  // Absent deadband means every change counts, which is what a counter and an
  // enum need. A present one is compared against the *stored* reference.
  return deadband === undefined || Math.abs(value - reference) >= deadband;
}

/**
 * Build a change encoder. All state is closure-local and per metric key, so a
 * second instance shares nothing and a profile swap is a new encoder.
 */
export function createChangeEncoder(deps: ChangeEncoderDeps): ChangeEncoder {
  const bucketMs = deps.bucketMs ?? 60_000;
  const gapMs = deps.gapMs ?? 15_000;
  const open = new Map<string, Open>();

  const bucketEnd = (ms: number): number => Math.floor(ms / bucketMs) * bucketMs + bucketMs;

  /** Close `state` at `endMs` and return the row, or null for a zero-width one. */
  function closeAt(state: Open, endMs: number): EncodedRow | null {
    const durMs = endMs - state.startMs;
    // A zero-width interval is not an observation. It happens when a reading
    // lands exactly on a boundary the previous one already reached.
    return durMs <= 0 ? null : { time: new Date(state.startMs), value: state.value, durMs };
  }

  /**
   * Handle a reading that lands past the open interval's bucket boundary: the
   * interval is closed *at* the boundary so no stored interval ever spans one.
   *
   * `restarted` says the silence since the boundary was long enough to be a gap
   * rather than a held value, in which case the interval has been restarted at
   * this reading and the caller has nothing further to decide — nothing is known
   * about the gap, and "unchanged" must not become "unknown".
   */
  function crossBucket(
    metric: string,
    state: Open,
    nowMs: number,
    value: number,
  ): { rows: EncodedRow[]; restarted: boolean } {
    const boundary = bucketEnd(state.startMs);
    if (nowMs < boundary) return { rows: [], restarted: false };
    // The value is credited to the boundary at most, so an outage that began
    // right after the last reading over-credits by less than one bucket, never
    // more.
    const closed = closeAt(state, boundary);
    const rows = closed ? [closed] : [];
    if (nowMs - boundary <= gapMs) {
      // Continuous across the boundary: carry the held value forward, so a flat
      // metric emits exactly one row per bucket and the durations in a bucket
      // sum to its width.
      state.startMs = boundary;
      return { rows, restarted: false };
    }
    open.set(metric, { startMs: nowMs, value });
    return { rows, restarted: true };
  }

  function observe(metric: string, at: Date, value: number): EncodedRow[] {
    const nowMs = at.getTime();
    const state = open.get(metric);
    // Nothing open, or a reading older than the open interval (a clock step, a
    // replayed capture) — which cannot be measured against it without emitting a
    // negative duration. Either way, start fresh here.
    if (!state || nowMs < state.startMs) {
      open.set(metric, { startMs: nowMs, value });
      return [];
    }

    const crossed = crossBucket(metric, state, nowMs, value);
    if (crossed.restarted) return crossed.rows;

    if (exceeds(value, state.value, deps.deadbandFor(metric))) {
      const closed = closeAt(state, nowMs);
      if (closed) crossed.rows.push(closed);
      open.set(metric, { startMs: nowMs, value });
    }
    return crossed.rows;
  }

  function close(at: Date): TaggedRow[] {
    const endMs = at.getTime();
    const rows: TaggedRow[] = [];
    for (const [metric, state] of open) {
      const closed = closeAt(state, Math.min(endMs, bucketEnd(state.startMs)));
      if (closed) rows.push({ metric, ...closed });
    }
    open.clear();
    return rows;
  }

  return {
    observe,
    close,
    get openCount() {
      return open.size;
    },
  };
}
