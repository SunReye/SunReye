import { untrack } from "svelte";
import { linear } from "svelte/easing";
import { Tween } from "svelte/motion";

/** Shortest glide, so a burst of samples still animates rather than snapping. */
const MIN_DURATION_MS = 300;
/** Overshoot factor: the glide is slightly longer than the gap it covers, so the
 *  cursor keeps trailing instead of arriving early and freezing. */
const OVERSHOOT = 1.15;

/**
 * The scroll cursor shared by the live charts (`live-area.svelte`,
 * `custom-live-chart.svelte`).
 *
 * A real-time cursor that drifts continuously toward the newest sample instead
 * of snapping to it once a second. Mirrors AnimatedNumber: every transition is
 * stretched across the feed's own sample spacing (`interval`, measured from the
 * points, so it is correct for any source) and eased linearly, so the plot
 * glides rather than updating on a visible per-sample cadence. The small
 * overshoot keeps the cursor gently trailing so it never reaches the target and
 * freezes between samples — the old wall-clock gap capped at 2 s did exactly
 * that on slow feeds. `interval` is itself clamped (see `live-window.ts`), a
 * deliberate ceiling: past that the chart steps rather than scrolling a
 * barely-moving cursor across a two-minute window.
 *
 * Only the marks' translate reads {@link LiveCursor.current} — never the data or
 * the x domain — so the chart itself does NOT re-render per animation frame.
 *
 * Call it during component initialization: it registers an `$effect`.
 *
 * @param lastT Timestamp of the newest sample, or undefined while there is none.
 * @param interval Spacing between the last two samples, in ms.
 */
export function liveCursor(
  lastT: () => number | undefined,
  interval: () => number,
): { readonly current: number } {
  const cursor = new Tween(untrack(lastT) ?? 0);
  $effect(() => {
    const t = lastT(); // track live updates only
    if (t === undefined) return;
    // Untracked: `interval` changes in lockstep with `lastT`, and only a new
    // sample should drive a new glide.
    void cursor.set(t, {
      duration: Math.max(MIN_DURATION_MS, untrack(interval) * OVERSHOOT),
      easing: linear,
    });
  });
  return {
    get current() {
      return cursor.current;
    },
  };
}
