/**
 * Where a chart tooltip goes, as arithmetic.
 *
 * LayerChart's own containment (Tooltip.svelte, `contained: 'container'`) only
 * ever FLIPS the box to the other side of the pointer and never clamps the
 * result. Measured on /statistics at 390px: a 241px-wide tooltip, flipped to
 * the left of a pointer at viewport x 195, landed at `left: -53` — 53px off the
 * screen, which is the "clipped off the left edge" report. The same flip is
 * what put it under the finger.
 *
 * So the app hands LayerChart NUMBERS for x and y instead, which switches its
 * containment off entirely (`typeof x !== 'number'` guards every branch of it)
 * and makes the position this file's business.
 *
 * ## Why this measures nothing
 *
 * A tooltip that measures its own box, moves, and measures again is the PR #60
 * failure class — a reactive loop that re-entered its own input. Nothing here
 * reads the rendered tooltip. Two consequences, both deliberate:
 *
 *  - the WIDTH is a reserved cap, not the real width. The component applies the
 *    same number as `max-width`, so "inside the viewport" is arithmetic. The
 *    price is that a narrow tooltip near a screen edge sits further from the
 *    pointer than it strictly had to; the alternative is the loop.
 *  - the HEIGHT is never needed, because the anchor carries it: `bottom-left`
 *    means "y IS the bottom edge", so clearing a fingertip is exact without
 *    knowing how tall the box came out. {@link TOOLTIP_HEIGHT_BUDGET} is only
 *    used to CHOOSE a side.
 *
 * Everything the caller passes is an input it already has (the pointer, the
 * chart's own rect, the window), so the result is a pure function of the
 * pointer: held still, it cannot move.
 *
 * ## Why the budgets below are not exported
 *
 * `placeTooltip` is the whole public surface. The numbers are tuning, and a
 * test that imports the very constant it is checking moves with it and asserts
 * nothing — so ./tooltip-placement.test.ts restates the ones it needs and pins
 * the CONTRACT (a fingertip of clearance, a capped rather than proportional
 * width) instead of the current value of the dial.
 */

import { TOOLTIP_VIEWPORT_MARGIN } from "$lib/layout/tokens";

/**
 * Widest box the placement will reserve, in CSS px, and the `max-width` the
 * tooltip is held to. 14rem: the measured chart tooltips run 144–241px wide,
 * so this fits all but the widest whole and wraps that one's rows rather than
 * pushing the box off a 390px screen.
 */
const TOOLTIP_MAX_WIDTH = 224;

/** Gap between a mouse cursor and the box — enough not to sit under the arrow. */
const POINTER_GAP = 12;

/**
 * Gap between a TOUCH point and the box. A fingertip covers roughly a 40px
 * disc and the contact point is its centre, so anything less than this leaves
 * the numbers under the finger — the second half of the report.
 */
const TOUCH_CLEARANCE = 56;

/**
 * Height the placement assumes when choosing a side, in CSS px. Above the
 * measured tallest chart tooltip (138px) with headroom, so "it fits above" is
 * never optimistic. Over-estimating only makes the choice conservative — the
 * box flips below a little earlier than it had to; under-estimating would let a
 * tall tooltip clip the top edge, which is why the browser spec measures the
 * real boxes on the real charts.
 */
const TOOLTIP_HEIGHT_BUDGET = 176;

/** Which edge of the box the returned `y` names. */
export type TooltipAnchor = "top-left" | "bottom-left";

export type TooltipPlacement = {
  /** Left edge, in the chart container's coordinates — what LayerChart wants. */
  x: number;
  /** Top or bottom edge per {@link TooltipPlacement.anchor}, same coordinates. */
  y: number;
  anchor: TooltipAnchor;
  /** Reserved width; the component applies it as `max-width`. */
  maxWidth: number;
};

export type TooltipPlacementInput = {
  /** Pointer position as LayerChart reports it: relative to `.lc-root-container`. */
  pointerX: number;
  pointerY: number;
  /** That container's own viewport offset. */
  containerLeft: number;
  containerTop: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Is the primary pointer a finger? (`$lib/charts/pointer`) */
  coarse: boolean;
};

/** The cap, or all the room there is between the margins — whichever is less. */
function tooltipMaxWidth(viewportWidth: number): number {
  return Math.max(0, Math.min(TOOLTIP_MAX_WIDTH, viewportWidth - 2 * TOOLTIP_VIEWPORT_MARGIN));
}

/** `value` held inside `[low, high]`, and inside `low` when there is no range. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * The tooltip's box for one pointer position.
 *
 * Horizontally: a mouse gets the box beside the cursor, a finger gets it
 * CENTRED on the touch — the numbers then read straight above the thumb instead
 * of beside it, and centring is what keeps a tooltip at the right edge of the
 * plot from needing the flip that caused the bug. Then one clamp, in VIEWPORT
 * coordinates rather than the chart's: a chart inset in a card would otherwise
 * keep the box out of its own gutter and off the screen anyway.
 *
 * Vertically: a finger prefers ABOVE (nothing else clears the hand), a mouse
 * keeps the below-the-cursor placement the app already had. Either flips to the
 * other side when its own side would leave the screen, which is what makes a
 * touch near the top edge work.
 */
export function placeTooltip(input: TooltipPlacementInput): TooltipPlacement {
  const margin = TOOLTIP_VIEWPORT_MARGIN;
  const maxWidth = tooltipMaxWidth(input.viewportWidth);
  const pointerViewportX = input.containerLeft + input.pointerX;
  const pointerViewportY = input.containerTop + input.pointerY;

  const wantedLeft = input.coarse
    ? pointerViewportX - maxWidth / 2
    : pointerViewportX + POINTER_GAP;
  const left = clamp(wantedLeft, margin, input.viewportWidth - margin - maxWidth);

  const clearance = input.coarse ? TOUCH_CLEARANCE : POINTER_GAP;
  const room = clearance + TOOLTIP_HEIGHT_BUDGET;
  const fitsAbove = pointerViewportY - room >= margin;
  const fitsBelow = pointerViewportY + room <= input.viewportHeight - margin;
  const above = input.coarse ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;

  return {
    x: left - input.containerLeft,
    y: above ? input.pointerY - clearance : input.pointerY + clearance,
    anchor: above ? "bottom-left" : "top-left",
    maxWidth,
  };
}
