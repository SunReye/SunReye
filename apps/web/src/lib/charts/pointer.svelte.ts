/**
 * The coarse-pointer answer, once per app, reactively.
 *
 * Built ONCE because both halves of the chart-interaction work read it: the
 * tooltip placement (clear of a fingertip) and the gesture default (locked on
 * touch). The rule itself is ./pointer.ts, which is where it is tested.
 *
 * Seeded at module load rather than in an `$effect`: with `ssr: false` module
 * init IS the browser's first frame, so the first chart painted already has the
 * right answer and there is no hydration-time flip from an unlocked chart to a
 * locked one. The listener is for the cases that change under a running app —
 * a stylus put down, a keyboard folded back, a tablet docked to a mouse.
 */

import { coarseFrom, COARSE_POINTER_QUERY, type MediaView } from "./pointer";

const view: MediaView | undefined = typeof window === "undefined" ? undefined : window;

let coarse = $state(coarseFrom(view));

// One listener for the whole app, never removed — it outlives every chart and
// there is nothing to clean up when the last one unmounts.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia(COARSE_POINTER_QUERY).addEventListener("change", (event) => {
    coarse = event.matches;
  });
}

/** The primary pointer, as the whole chart layer sees it. */
export const pointerKind = {
  /** Is the primary pointer a finger (rather than a mouse or trackpad)? */
  get coarse() {
    return coarse;
  },
};
