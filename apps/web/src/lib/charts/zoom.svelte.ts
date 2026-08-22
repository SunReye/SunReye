/**
 * One chart's gesture state: which of the three modes it is in, and the way out.
 *
 * The mode VOCABULARY and the props each mode implies are ./gesture.ts, which is
 * pure and unit-tested. This file is the part that cannot be: a rune holding
 * what the viewer last tapped, and the LayerChart context a reset has to reach.
 *
 * The resting mode follows the POINTER (./pointer.svelte.ts):
 *
 *  - a finger rests LOCKED. A drag scrolls the page, a hold scrubs the tooltip
 *    crosshair, and pinch/pan are ignored. /history is a stack of ~100
 *    full-width charts and /statistics nine; on both, scrolling is the gesture
 *    people use every second and zooming the one they use twice a week, so the
 *    chart must not be holding the pointer by default. It used to: the brush was
 *    the resting mode on every pointer, and a horizontal swipe across a card on
 *    a phone selected a window and refetched every chart on the page
 *    (`e2e/chart-gesture-lock.spec.ts` measured 3 rollup calls turning into 6).
 *  - a mouse rests on the BRUSH — drag a window, refetch it at a finer rollup.
 *    A mouse drag cannot be mistaken for a page scroll, so there is nothing to
 *    defend against, and the landed /history and /statistics gesture is kept.
 *
 * Pinch is the third mode and is never a default: it is one tap away and the
 * way back out is always on screen (./zoom-controls.svelte). LayerChart wires
 * drag-to-select and drag-to-pan to the same pointer, so brushing and pinching
 * are mutually exclusive — a fact of the library, not a choice here.
 *
 * The mapping from a selection to a range lives in ./zoom-range.ts.
 */

import type { ChartState } from "layerchart";
import { display } from "$lib/display.svelte";
import { getLocale } from "$lib/paraglide/runtime";
import {
  gestureProps,
  restingMode,
  type BrushEndPayload,
  type BrushSelection,
  type GestureMode,
} from "./gesture";

import { pointerKind } from "./pointer.svelte";
import {
  labelOptionsFrom,
  MIN_BAND_EXTENT,
  minExtentFor,
  zoomedHistoryRangeFrom,
  type LabelOptions,
} from "./zoom-range";
import type { HistoryRange, RollupBucket } from "../inverter/ranges";

/**
 * Zone and clock for a zoom's own labels, from the viewer's display
 * preferences. Read inside a `$derived`/template it re-renders when the setting
 * is saved, like every other formatter in the app.
 */
export function zoomLabelOptions(): LabelOptions {
  return labelOptionsFrom(getLocale(), display.config);
}

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
  /** Has the viewer tapped the control? The only input to the mode besides the pointer. */
  let armed = $state(false);

  const minExtent = $derived(options.minExtent?.() ?? MIN_BAND_EXTENT);

  // The whole gesture decision, in one line: what the viewer asked for, else
  // what this pointer rests in. `pointerKind.coarse` is a rune, so a tablet
  // docked to a mouse moves every chart on the page without a remount.
  const mode = $derived<GestureMode>(armed ? "pinch" : restingMode(pointerKind.coarse));

  const gesture = $derived(
    gestureProps(mode, {
      minExtent,
      onBrushEnd: ({ brush: state }: BrushEndPayload) => {
        if (!state.active) return;
        options.onSelect?.(state.x);
        if (options.onSelect) context?.transform.reset();
      },
    }),
  );

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
      return { ...gesture, onTransform };
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
      return mode === "pinch";
    },
    /** Has the chart been moved off the window it was handed? */
    get zoomed() {
      return scale !== 1;
    },
    toggle() {
      armed = !armed;
      if (!armed) this.resetTransform();
    },
    /** Undo the local gesture without touching what the owner fetched. */
    resetTransform() {
      context?.transform.reset();
      scale = 1;
    },
    /** The way back: undo both the local gesture and whatever it made the owner fetch. */
    reset() {
      armed = false;
      this.resetTransform();
      options.onReset?.();
    },
  };
}

/**
 * The controller both history plots share: a drag selects a window and the OWNER
 * refetches it at a finer rollup.
 *
 * `metric-history-chart.svelte` and `custom-chart-plot.svelte` had this
 * construction character for character — the same floor, the same range
 * mapping, the same two callbacks. It is one behaviour ("select a window on a
 * history plot"), and two copies of it are two places to fix when the mapping
 * changes.
 *
 * `bucket` is a getter because it is reactive at both call sites: the floor
 * follows whatever rollup is currently on screen.
 */
export function historyZoom(options: {
  /** The bucket currently plotted; the selection floor is two of them. */
  bucket: () => RollupBucket;
  /** A settled selection, for the owner to refetch. */
  onZoom?: (range: HistoryRange) => void;
  /** Clear whatever the owner did with a previous selection. */
  onResetZoom?: () => void;
}): ChartZoom {
  return chartZoom({
    // Two of whatever bucket is on screen: on a 5-minute window a one-minute
    // drag is a fingertip's width, and a mis-tap that refetches every card on
    // the page is worse than no gesture at all.
    minExtent: () => minExtentFor(options.bucket()),
    onSelect: (x) => {
      const range = zoomedHistoryRangeFrom(x, zoomLabelOptions());
      if (range) options.onZoom?.(range);
    },
    onReset: () => options.onResetZoom?.(),
  });
}
