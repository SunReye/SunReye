/**
 * The coarse-pointer read, as one pure function.
 *
 * Two features hang off the answer — the tooltip has to clear a fingertip, the
 * gesture default is locked on touch and the brush on a mouse — and two
 * independent reads of `matchMedia` is how those two drift apart. The reactive
 * wrapper is ./pointer.svelte.ts; this half is here so it can be tested without
 * a rune scheduler, and so the SSR case is a written-down decision rather than
 * an `if (browser)` somebody added later.
 */

/**
 * `(pointer: coarse)` — the PRIMARY input device is imprecise.
 *
 * Deliberately not `(hover: none)` and not `(any-pointer: coarse)`: a
 * touch-screen laptop with a mouse attached answers yes to the second and is a
 * mouse to the person using it, and a stylus hovers while still being coarse.
 */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** Just enough of `window` to ask the question — and to fake it in a test. */
export type MediaView = { matchMedia?: (query: string) => { matches: boolean } };

/**
 * Is the primary pointer a finger?
 *
 * Absent window, or a browser with no `matchMedia`, reads as FINE. That is the
 * safe seed: it leaves the desktop brush gesture and the beside-the-cursor
 * tooltip as the pre-hydration state, which is what a machine with no touch
 * input goes on to keep. This app runs `ssr: false`, so module init already
 * happens in the browser and no real viewer sees the seed — but a wrong one
 * would show as a chart that starts unlocked and locks itself a frame later.
 */
export function coarseFrom(view: MediaView | undefined): boolean {
  return view?.matchMedia?.(COARSE_POINTER_QUERY).matches ?? false;
}
