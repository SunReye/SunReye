/**
 * How far a pointer may travel and still count as a press.
 *
 * One number, because two features ask the same question and a second copy
 * would be a second threshold to keep in step:
 *
 *  - the full-screen chip in a plot's corner (`layout/fullscreen-trigger.svelte`)
 *    sits on the surface a mouse drag brushes, so a selection that STARTS out on
 *    the plot and merely ends with the pointer over the chip must not also expand
 *    the card;
 *  - a held finger deciding between scrubbing the tooltip crosshair and letting
 *    the page scroll (./hold-scrub.ts).
 *
 * Its own module rather than living in either of them: the first shipped before
 * the second, and a layout component importing a gesture state machine to reach
 * one predicate is a dependency that says the wrong thing about both.
 */

export type Point = { x: number; y: number };

/**
 * Travel that forfeits a press, in CSS pixels.
 *
 * Not exported: nothing outside needs the number, only the answer, and an
 * exported constant with no consumer is the kind of API that grows callers who
 * re-implement the comparison. Its own test restates the 8 rather than importing
 * it — an independent measurement of the very value it claims, the way
 * `e2e/statistics-mobile-density.spec.ts` restates the tile floor.
 *
 * Fingers are not still, and neither is a hand on a mouse. 8px is roughly the
 * jitter of a thumb resting on glass and is the same slop Chromium uses before
 * it calls a touch a drag: below it a reader who meant to press keeps losing the
 * press, above it a slow swipe is mistaken for one.
 */
const SLOP_PX = 8;

/**
 * Has this pointer moved far enough to stop being a press?
 *
 * Measured as a RADIUS from the original point, not per axis and not frame to
 * frame. Per axis, a diagonal drag slips through by staying under the limit on
 * both; frame to frame, a steady 7px-per-frame drag is "still" forever.
 *
 * Squared distance, so the hot path never takes a square root.
 */
export function movedPastSlop(from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy > SLOP_PX * SLOP_PX;
}
