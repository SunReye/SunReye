/**
 * What a chart does with a finger, as three named modes.
 *
 * The decision, made with the user: on a coarse pointer the resting state is
 * LOCKED — a drag scrolls the page, a hold scrubs the tooltip, and pinch is one
 * tap away. Pinch-by-default would trap the finger on /history's ~100
 * full-width charts, where scrolling is the primary gesture.
 *
 * The mapping is pure because the thing that breaks is a prop LayerChart reads,
 * not a value the user sees. Chart.base.svelte computes
 *
 *   disablePointer = brush === true || (brush is an object && !brush.disabled)
 *                    || transform.disablePointer
 *
 * and TransformContext.svelte then writes `style:touch-action` as
 * `mode && mode !== 'none' && !disablePointer ? 'none' : undefined`. So one
 * stray `disablePointer: true` on the pinch mode silently kills pinch while
 * every visible thing about the button stays correct — hence the assertion the
 * task names, pinned here.
 */

import { describe, expect, test } from "bun:test";
import { gestureProps, restingMode, type GestureMode } from "./gesture";

/**
 * Every mode, enumerated HERE rather than exported from the source.
 *
 * `Record<GestureMode, true>` is what makes this exhaustive: adding a mode to
 * the union stops this file compiling until it is listed, so the sweep below
 * cannot quietly skip one. An exported array would have to be kept in step by
 * hand and would be dead weight in the shipped bundle.
 */
const EVERY_MODE: Record<GestureMode, true> = { locked: true, brush: true };
const GESTURE_MODES = Object.keys(EVERY_MODE) as GestureMode[];

describe("the resting mode", () => {
  test("is locked on a coarse pointer", () => {
    expect(restingMode(true)).toBe("locked");
  });

  test("and stays the brush on a mouse", () => {
    // The landed /history and /statistics feature: drag a window, refetch it at
    // a finer rollup. A mouse drag cannot be confused with a page scroll.
    expect(restingMode(false)).toBe("brush");
  });
});

describe("pinch is not a mode any more", () => {
  // THE assertion of this whole change, and it reads backwards: the way pinch
  // became always-available was to take the pointer away from the library in
  // EVERY mode. Its `onPointerDown` returns early on `disablePointer`, and pinch
  // and one-finger pan enter through that same call — so leaving it enabled to
  // get pinch also writes `touch-action: none` and preventDefaults every
  // touchmove, single pointer included, which is what took page scrolling away.
  // `charts/touch-gestures.ts` arbitrates two fingers instead, outside it.
  test("so no mode hands LayerChart the pointer", () => {
    for (const mode of GESTURE_MODES) {
      expect(gestureProps(mode).transform.disablePointer, mode).toBe(true);
    }
  });

  // A regression here is invisible on a mouse and total on a phone: the chart
  // would eat every vertical swipe on a page ~100 charts deep.
  test("and there is no mode left that could", () => {
    expect(GESTURE_MODES).not.toContain("pinch" as GestureMode);
  });
});

describe("locked", () => {
  test("hands the pointer back to the browser so the page can scroll", () => {
    // `disablePointer: true` is what stops TransformContext writing
    // `touch-action: none` and calling preventDefault() on every touchmove.
    expect(gestureProps("locked").transform.disablePointer).toBe(true);
  });

  test("and draws no brush layer, which ships its own touch-action: none", () => {
    expect(gestureProps("locked").brush).toEqual({ disabled: true });
  });
});

describe("brush", () => {
  test("carries the mis-tap floor it was given", () => {
    const brush = gestureProps("brush", { minExtent: 7 }).brush;
    expect(brush).toMatchObject({ axis: "x", minExtent: { x: 7 } });
  });

  test("reports a settled selection", () => {
    const seen: unknown[] = [];
    const brush = gestureProps("brush", { onBrushEnd: (x) => seen.push(x) }).brush;
    expect(typeof (brush as { onBrushEnd?: unknown }).onBrushEnd).toBe("function");
  });

  test("and keeps the pointer transform off, as LayerChart would anyway", () => {
    expect(gestureProps("brush").transform.disablePointer).toBe(true);
  });
});

describe("every mode", () => {
  test.each([...GESTURE_MODES])(
    "%s narrows the domain rather than the pixels",
    (mode: GestureMode) => {
      // `canvas` magnifies strokes that were already drawn; `domain` re-ticks the
      // axes and keeps every line 1px. The floor of 1 stops a chart being zoomed
      // out past the window it was handed.
      const { transform } = gestureProps(mode);
      expect(transform.mode).toBe("domain");
      expect(transform.axis).toBe("x");
      expect(transform.scaleExtent[0]).toBe(1);
    },
  );

  test("is one of exactly two", () => {
    expect([...GESTURE_MODES].sort()).toEqual(["brush", "locked"]);
  });
});
