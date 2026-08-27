/** Smoothing factor of the cadence EMA — one odd gap nudges, it never whips. */
const ALPHA = 0.3;

/** Bounds a measured gap is clamped into before it reaches the estimate. */
export interface CadenceBounds {
  /** Fastest spacing the feed can plausibly have (ms). */
  minMs: number;
  /** Slowest spacing the feed can plausibly have (ms). */
  maxMs: number;
}

/** The inverter poll config allows anything from 1 s to 1 h; nothing outside is real. */
const DEFAULT_BOUNDS: CadenceBounds = { minMs: 1000, maxMs: 3_600_000 };

/** Nominal 1 Hz feed — what the estimate assumes before it has measured anything. */
const SEED_MS = 1000;

/**
 * Exponentially-smoothed spacing between live samples, in ms. Consumers
 * (`AnimatedNumber`, the live chart cursor) stretch their per-frame glide
 * across it so values drift continuously between samples instead of snapping
 * and then freezing until the next one.
 *
 * Plain TS on purpose: the store's `cadenceMs` is a rune, and runes don't run
 * under `bun test` — the arithmetic that can actually be wrong lives here.
 */
export class CadenceTracker {
  #cadenceMs: number;
  #bounds: CadenceBounds;
  /** Timestamp of the previous sample; `null` means "no spacing known yet". */
  #lastSampleT: number | null = null;

  constructor(bounds: Partial<CadenceBounds> & { seedMs?: number } = {}) {
    this.#bounds = { ...DEFAULT_BOUNDS, ...bounds };
    // Seed at the nominal 1 Hz feed so the first frames glide sensibly.
    this.#cadenceMs = bounds.seedMs ?? SEED_MS;
  }

  // fallow-ignore-next-line unused-class-member -- read as `this.#cadence.x` from the store; calls through a private-field receiver aren't traced
  get cadenceMs(): number {
    return this.#cadenceMs;
  }

  /**
   * Forget the anchor on a fresh connection: the gap across an outage is not a
   * poll interval. The estimate itself is kept — the feed's real cadence did
   * not change just because the socket did.
   */
  // fallow-ignore-next-line unused-class-member -- read as `this.#cadence.x` from the store; calls through a private-field receiver aren't traced
  reset(): void {
    this.#lastSampleT = null;
  }

  /** Fold one sample timestamp in and return the current estimate. */
  // fallow-ignore-next-line unused-class-member -- read as `this.#cadence.x` from the store; calls through a private-field receiver aren't traced
  sample(t: number): number {
    const last = this.#lastSampleT;
    // Re-anchor even on a rejected delta, so the *next* gap is measured from
    // the sample we actually saw rather than from a pre-clock-step timestamp.
    this.#lastSampleT = t;
    if (last === null) return this.#cadenceMs;
    const delta = t - last;
    // A zero or negative delta is a duplicate frame or a backwards clock, not a
    // spacing — clamping it would silently report the floor as a measurement.
    if (delta <= 0) return this.#cadenceMs;
    const clamped = Math.min(this.#bounds.maxMs, Math.max(this.#bounds.minMs, delta));
    this.#cadenceMs = this.#cadenceMs * (1 - ALPHA) + clamped * ALPHA;
    return this.#cadenceMs;
  }
}
