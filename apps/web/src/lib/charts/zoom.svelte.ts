/**
 * The two zoom gestures a chart offers, and why they are never both live.
 *
 * LayerChart wires drag-to-select and drag-to-pan to the same pointer, so
 * `Chart` switches the transform's pointer handling off for as long as a brush
 * is enabled (`disablePointer` in Chart.base.svelte). Two-finger pinch rides on
 * those same pointer events, which makes brushing and pinching mutually
 * exclusive — not a choice made here, a fact of the library.
 *
 * That is the right default anyway on a phone. A live pointer transform sets an
 * inline `touch-action: none` AND calls `preventDefault()` on every touchmove,
 * so a vertical swipe that starts on a chart stops scrolling /history and
 * /statistics — tall stacks of full-width charts where scrolling is the primary
 * gesture. So the brush is the resting state (a horizontal drag selects, a
 * vertical one still scrolls the page, see chart-container's `touch-pan-y`
 * override), and pinch is something the viewer switches ON for one chart and is
 * given a visible way back out of.
 *
 * The mapping from a selection to a range lives in ./zoom-range.ts, which is
 * where it can be tested; this only holds the gesture state.
 */

import type { ChartState } from "layerchart";
import { display } from "$lib/display.svelte";
import { getLocale } from "$lib/paraglide/runtime";
import { labelOptionsFrom, MIN_BAND_EXTENT, type LabelOptions } from "./zoom-range";

/**
 * Zone and clock for a zoom's own labels, from the viewer's display
 * preferences. Read inside a `$derived`/template it re-renders when the setting
 * is saved, like every other formatter in the app.
 */
export function zoomLabelOptions(): LabelOptions {
  return labelOptionsFrom(getLocale(), display.config);
}

/** The x edges of a settled brush, in domain values. */
export type BrushSelection = readonly (number | Date | string | null)[];

/**
 * The brush payload, typed loosely enough to be a supertype of LayerChart's
 * own `BrushState` — the package does not export that type, and a handler whose
 * parameter is any narrower is rejected by the prop it is assigned to.
 */
type BrushEnd = { brush: { active?: boolean; x: BrushSelection } };

export type ChartZoomOptions = {
  /**
   * The narrowest selection that counts as a zoom. Continuous scales measure it
   * in domain units, band and point scales in categories — a getter, because a
   * continuous floor follows the bucket currently on screen.
   */
  minExtent?: () => number;
  /**
   * A settled selection, for a chart whose owner answers a zoom by refetching.
   * Its presence is what tells this controller the narrowed domain is somebody
   * else's business: the local transform is reset straight after, or the chart
   * would show the new, finer data magnified through the old gesture.
   */
  onSelect?: (x: BrushSelection) => void;
  /** Clear whatever the owner did with a previous selection. */
  onReset?: () => void;
};

export type ChartZoom = ReturnType<typeof chartZoom>;

export function chartZoom(options: ChartZoomOptions = {}) {
  // Deliberately NOT `$state`: this is written from inside the render of the
  // chart it belongs to (see `capture`), and a reactive write there is a
  // state_unsafe_mutation. Nothing reads it during render either — only the
  // reset handler does, long after. What the UI reacts to is `scale` below,
  // which arrives through an event callback like any other.
  let context: ChartState<any> | undefined;

  let scale = $state(1);
  let pinching = $state(false);

  const minExtent = $derived(options.minExtent?.() ?? MIN_BAND_EXTENT);

  const brush = $derived(
    pinching
      ? // Pointer transform and brush cannot share the pointer; disabling the
        // brush is what hands pinch and pan back to the transform.
        { disabled: true }
      : {
          axis: "x" as const,
          minExtent: { x: minExtent },
          onBrushEnd: ({ brush: state }: BrushEnd) => {
            if (!state.active) return;
            options.onSelect?.(state.x);
            if (options.onSelect) context?.transform.reset();
          },
        },
  );

  // `domain` rather than `canvas`: narrowing the DATA domain re-ticks the axes
  // and keeps every stroke 1px, where a canvas transform magnifies the pixels
  // it already drew. `scaleExtent` floors at 1 so the chart can never be zoomed
  // out past the window it was given.
  const transform = {
    mode: "domain" as const,
    axis: "x" as const,
    scaleExtent: [1, 64] as [number, number],
  };

  const onTransform = (details: { scale: number }) => {
    scale = details.scale;
  };

  return {
    /**
     * Everything a chart has to hand LayerChart, in one spread. `onTransform`
     * has to be a top-level Chart prop rather than a field of `transform`:
     * Chart.base passes its own (undefined) one AFTER spreading the options
     * object, so a handler set inside `transform` is overwritten with nothing.
     */
    get props() {
      return { brush, transform, onTransform };
    },
    /**
     * Take the chart context out of a `belowContext` snippet. The canvas
     * wrappers do not re-export `context` as bindable, so a snippet is the only
     * way to reach the transform state on the very charts (price track, YoY)
     * whose band counts made them canvas in the first place. Returns the empty
     * string because it is called from a render position.
     */
    capture(next: ChartState<any>): string {
      context = next;
      return "";
    },
    /** Is the pinch gesture armed (and page scrolling on this chart suspended)? */
    get pinching() {
      return pinching;
    },
    /** Has the chart been moved off the window it was handed? */
    get zoomed() {
      return scale !== 1;
    },
    toggle() {
      pinching = !pinching;
      if (!pinching) this.resetTransform();
    },
    /** Undo the local gesture without touching what the owner fetched. */
    resetTransform() {
      context?.transform.reset();
      scale = 1;
    },
    /** The way back: undo both the local gesture and whatever it made the owner fetch. */
    reset() {
      pinching = false;
      this.resetTransform();
      options.onReset?.();
    },
  };
}
