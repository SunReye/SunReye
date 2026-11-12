// Ported from v3 (dev 780b4e2, components/inverter/_shared/glide.ts): one glide length for
// everything that drifts between live ticks, the number readouts and the live graph (ADR 21).

/** Floor for a glide, so a fast feed does not degenerate into a flicker. */
const MIN_GLIDE_MS = 300;

/**
 * How far past the cadence a glide stretches: the motion is still running when the next sample
 * lands, instead of arriving early and freezing, which reads as a feed that stopped, then jumped.
 */
const GLIDE_OVERSHOOT = 1.15;

/**
 * Glide length for a feed ticking every `gapMs`. A first frame, a restart or a stalled feed can
 * hand this 0, a negative or NaN: those take the floor. `still` (reduced motion, low power) is 0,
 * a snap per sample: the drift is an affordance, not information.
 */
export function glideDurationMs(gapMs: number, still: boolean): number {
  if (still) return 0;

  if (!Number.isFinite(gapMs) || gapMs <= 0) return MIN_GLIDE_MS;

  return Math.max(MIN_GLIDE_MS, gapMs * GLIDE_OVERSHOOT);
}
