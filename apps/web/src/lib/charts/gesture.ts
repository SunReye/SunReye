/**
 * What a chart does with a finger, as three named modes.
 *
 * The decision, made with the user: on a coarse pointer the resting state is
 * LOCKED. A drag scrolls the PAGE, a hold scrubs the tooltip crosshair, and
 * pinch/pan are ignored until the viewer taps the lock. Pinch-by-default would
 * trap the finger on /history, which is ~100 full-width charts deep and where
 * scrolling is the primary gesture; pinch stays one tap away.
 *
 * On a mouse the resting state stays the BRUSH — drag a window, refetch it at a
 * finer rollup (./zoom-range.ts). A mouse drag cannot be mistaken for a page
 * scroll, so nothing is being defended against there.
 *
 * Pure, because what breaks is a prop LayerChart reads rather than a value the
 * viewer sees. Chart.base.svelte computes
 *
 *   disablePointer = brush === true || (brush is an object && !brush.disabled)
 *                    || transform.disablePointer
 *
 * and TransformContext.svelte then writes
 * `style:touch-action={mode && mode !== 'none' && !disablePointer ? 'none' : undefined}`
 * and calls `preventDefault()` on every touchmove under the same condition. So:
 *
 *  - pinch  → disablePointer FALSY → inline `touch-action: none` → the plot
 *    captures the two-finger gesture, and page scrolling on that one chart
 *    stops (which is why it is opt-in, and why the way out is always visible).
 *  - locked → disablePointer true → no inline rule, no preventDefault, and no
 *    `.lc-brush-context` (BrushContext renders none while disabled, and its own
 *    stylesheet is where `touch-action: none` would come from). What is left is
 *    the tooltip layer's `--touch-action: pan-y`, so a vertical swipe scrolls
 *    the page and a hold scrubs.
 *  - brush  → the same, plus the brush layer, which chart-container.svelte
 *    overrides to `touch-pan-y` for the same reason.
 */

/**
 * The x edges of a settled brush, in domain values.
 *
 * Loose on purpose: it has to be a SUPERTYPE of LayerChart's own `BrushState`,
 * which the package does not export, and a handler whose parameter is any
 * narrower is rejected by the prop it is assigned to.
 */
export type BrushSelection = readonly (number | Date | string | null)[];

/** A settled brush selection, as LayerChart hands it over. */
export type BrushEndPayload = { brush: { active?: boolean; x: BrushSelection } };

export type GestureMode = "locked" | "brush" | "pinch";

/** What a chart rests in when nobody has touched the lock. */
export function restingMode(coarse: boolean): GestureMode {
  return coarse ? "locked" : "brush";
}

export type BrushProps =
  | { disabled: true }
  | {
      axis: "x";
      minExtent: { x: number };
      onBrushEnd?: (payload: BrushEndPayload) => void;
    };

export type TransformProps = {
  mode: "domain";
  axis: "x";
  scaleExtent: [number, number];
  /** True hands the pointer back to the browser; see the header. */
  disablePointer: boolean;
};

export type GestureOptions = {
  /**
   * Narrowest selection that counts as a zoom — domain units on a continuous
   * scale, categories on a band one (./zoom-range.ts).
   */
  minExtent?: number;
  onBrushEnd?: (payload: BrushEndPayload) => void;
};

/**
 * `domain` rather than `canvas`: narrowing the DATA domain re-ticks the axes and
 * keeps every stroke 1px, where a canvas transform magnifies pixels already
 * drawn. The floor of 1 stops a chart being zoomed out past its own window.
 */
const TRANSFORM: Omit<TransformProps, "disablePointer"> = {
  mode: "domain",
  axis: "x",
  scaleExtent: [1, 64],
};

/** Everything a chart hands LayerChart for `mode`, in one object. */
export function gestureProps(
  mode: GestureMode,
  options: GestureOptions = {},
): { brush: BrushProps; transform: TransformProps } {
  const transform: TransformProps = { ...TRANSFORM, disablePointer: mode !== "pinch" };
  if (mode !== "brush") return { brush: { disabled: true }, transform };
  return {
    brush: {
      axis: "x",
      minExtent: { x: options.minExtent ?? 2 },
      onBrushEnd: options.onBrushEnd,
    },
    transform,
  };
}
