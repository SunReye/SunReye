/**
 * How long one glide lasts — the single policy shared by everything on the page
 * that drifts between samples.
 *
 * Two things glide against the same feed: the numeric readouts
 * (`animated-number.svelte`, via its Tween) and the live charts' scroll cursor
 * (`live-cursor.svelte.ts`). They sit next to each other on /history, so the
 * floor and the overshoot are one decision, not two that happen to agree. They
 * were previously spelled twice — `MIN_GLIDE_MS`/`GLIDE_OVERSHOOT` beside the
 * readouts and `MIN_DURATION_MS`/`OVERSHOOT` beside the geometry — with nothing
 * tying the copies together, so a tweak to one would have desynchronised the
 * number drift from the chart drift with no test going red.
 */

/** Floor for a glide, so a fast feed does not degenerate into a flicker. */
const MIN_GLIDE_MS = 300;

/**
 * How far past the sample cadence a glide is stretched. The overshoot means the
 * motion is still gently running toward its target when the next sample lands —
 * instead of arriving early and freezing until the feed ticks again, which is
 * what made a slow feed look like it stopped, then jumped.
 */
const GLIDE_OVERSHOOT = 1.15;

/**
 * Glide length for a feed ticking every `gapMs`.
 *
 * `gapMs` is the feed's own measured spacing — `sampleInterval()` for the charts
 * (already clamped) and the bus's cadence estimate for the readouts (not
 * clamped, so a first frame, a counter restart or a stalled feed can hand this
 * 0, a negative or NaN). All of those take the floor rather than collapsing the
 * glide to a snap.
 *
 * Under `prefers-reduced-motion` this is 0: the Tween snaps on each sample, the
 * rAF loop never starts, and the value still updates once per feed tick — it
 * just stops drifting. The drift is a motion affordance, not information, so it
 * is the right thing to drop; do not "restore" it unconditionally.
 */
export function glideDurationMs(gapMs: number, reduceMotion: boolean): number {
  if (reduceMotion) return 0;
  if (!Number.isFinite(gapMs) || gapMs <= 0) return MIN_GLIDE_MS;
  return Math.max(MIN_GLIDE_MS, gapMs * GLIDE_OVERSHOOT);
}
