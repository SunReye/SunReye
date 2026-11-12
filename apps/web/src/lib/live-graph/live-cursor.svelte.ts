// Ported from v3 (dev 780b4e2, components/inverter/_shared/live-cursor.svelte.ts) by way of the
// prototype. The glide policy is #704's `glide.ts`, and stillness is the motion tier's (ADR 21).
import { untrack } from "svelte";
import { linear } from "svelte/easing";
import { Tween } from "svelte/motion";
import { glideDurationMs } from "../live/glide.ts";

/** Where the glide is now, in epoch milliseconds. */
export interface Cursor {
  readonly current: number;
}

/**
 * The live graph's scroll cursor: it drifts toward the newest sample instead of snapping to it,
 * each glide stretched linearly across the feed's own spacing (`interval`, measured from the
 * points, clamped in `live-window.ts`). Only the marks' translate reads `current`, never the data
 * or the x domain, so the chart does not re-render per frame. `still` snaps per sample.
 *
 * Call it during component initialisation: it registers an `$effect`.
 */
export function liveCursor(
  lastT: () => number | undefined,
  interval: () => number,
  still: () => boolean,
): Cursor {
  const cursor = new Tween(untrack(lastT) ?? 0);

  $effect(() => {
    const t = lastT();

    if (t === undefined) return;

    // Untracked: `interval` changes in lockstep with `lastT`; only a new sample starts a glide.
    void cursor.set(t, { duration: glideDurationMs(untrack(interval), still()), easing: linear });
  });

  return {
    get current() {
      return cursor.current;
    },
  };
}
