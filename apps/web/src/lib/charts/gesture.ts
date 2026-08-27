/**
 * What a chart does with a finger, as two named modes.
 *
 * The decision, revised with the user: a phone already knows how to pinch and
 * should not have to be told. Two fingers zoom, always, with nothing to arm —
 * see `./touch-gestures.ts`, which is where that gesture is now decided, and
 * `gestureProps` below for why making it unconditional meant taking the pointer
 * away from the library rather than giving it more.
 *
 * What a single finger does is unchanged, and deliberately so. On a coarse
 * pointer a chart is LOCKED to it: a drag scrolls the PAGE and a hold scrubs the
 * tooltip crosshair. One-finger brushing is what turned three rollup calls into
 * six on a mis-swipe down /history, ~100 full-width charts deep, and it is not
 * coming back.
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

export type GestureMode = "locked" | "brush";

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

/**
 * Everything a chart hands LayerChart for `mode`, in one object.
 *
 * `disablePointer` is now UNCONDITIONALLY true, which is the whole of the pinch
 * change and needs saying out loud, because it reads backwards: the way to make
 * pinch always available was to stop letting the library have the pointer at all.
 *
 * Its pointer path is one door. `states/transform.svelte.js`, `onPointerDown`
 * returns early on `disablePointer`, and pinch and one-finger pan enter through
 * that same call — so there is no setting that yields "two fingers yes, one
 * finger no". Leaving it enabled to get pinch also writes an inline
 * `touch-action: none` and `preventDefault()`s every touchmove, single pointer
 * included, which is exactly what took page scrolling away and forced pinch to
 * be opt-in behind a chip on a page ~100 charts deep.
 *
 * So the library draws and we arbitrate: `./touch-gestures.ts` decides per event
 * whether a gesture is ours, and drives the transform through the context the
 * chart already captures. A single finger is never touched, so the page keeps
 * scrolling and a hold keeps scrubbing the crosshair through the tooltip layer's
 * own `pan-y` — which is what LOCKED always meant and now means for pinch too.
 */
export function gestureProps(
  mode: GestureMode,
  options: GestureOptions = {},
): { brush: BrushProps; transform: TransformProps } {
  const transform: TransformProps = { ...TRANSFORM, disablePointer: true };
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
