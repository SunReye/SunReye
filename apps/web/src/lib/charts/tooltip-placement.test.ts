/**
 * Where a chart tooltip is allowed to be.
 *
 * The bug this pins, measured on /statistics at 390px: LayerChart's own
 * containment only ever FLIPS the box to the other side of the pointer
 * (Tooltip.svelte, `contained: 'container'`) and never clamps the result, so a
 * 241px-wide tooltip flipped left of a pointer at viewport x 195 landed at
 * left: -53 — 53px off the screen.
 *
 * So the app hands LayerChart NUMBERS instead, and these are the numbers. A
 * pure function on purpose: the alternative is measure → position → measure,
 * which is the PR #60 failure class. Nothing here reads the tooltip's own box;
 * the width it reserves is a cap the component also applies as `max-width`, so
 * the promise "inside the viewport" is arithmetic rather than a settling loop.
 *
 * `placeTooltip` is the only thing imported. Its budgets are deliberately not
 * exported: a case that imports the constant it is checking moves with the
 * constant and asserts nothing. What is restated below is a CONTRACT — a
 * fingertip is 40px, a width cap is a cap and not a proportion — and the source
 * is free to tune inside it. The one budget that has to be a number here is the
 * height a box is assumed to be, because the box's own height is the thing this
 * design refuses to measure; `e2e/chart-tooltip-viewport.spec.ts` is what
 * measures the real ones on the real charts.
 */

import { describe, expect, test } from "bun:test";
import { TOOLTIP_VIEWPORT_MARGIN } from "../layout/tokens";
import { placeTooltip } from "./tooltip-placement";

const MARGIN = TOOLTIP_VIEWPORT_MARGIN;

/** A fingertip's radius. Anything less than this leaves numbers under the hand. */
const FINGER_CLEARANCE = 40;

/** Widest a box beside a cursor may sit from it before it reads as detached. */
const MAX_CURSOR_GAP = 24;

/**
 * The height the placement reserves when it chooses a side (its
 * `TOOLTIP_HEIGHT_BUDGET`). Restated because the whole point of anchoring at
 * `bottom-left` is that the source never measures a height — so a case that
 * wants to know where the box's far edge ended up has to supply one.
 */
const BUDGET_HEIGHT = 176;

/** The phone the tooltip was reported clipped on, and the chart box measured on it. */
const PHONE = { viewportWidth: 390, viewportHeight: 844 };
const CHART = { containerLeft: 29, containerTop: 300 };

const place = (pointerX: number, pointerY: number, coarse: boolean) =>
  placeTooltip({ ...PHONE, ...CHART, pointerX, pointerY, coarse });

/** The box the placement claims, in VIEWPORT coordinates. */
function viewportBox(p: ReturnType<typeof placeTooltip>, height = BUDGET_HEIGHT) {
  const left = p.x + CHART.containerLeft;
  const top = (p.anchor === "bottom-left" ? p.y - height : p.y) + CHART.containerTop;
  return { left, right: left + p.maxWidth, top, bottom: top + height };
}

/** Just the reserved width, for a viewport of `width`. */
const widthAt = (viewportWidth: number) =>
  placeTooltip({
    ...CHART,
    viewportWidth,
    viewportHeight: 844,
    pointerX: 60,
    pointerY: 60,
    coarse: true,
  }).maxWidth;

describe("the width it is allowed to reserve", () => {
  test("is CAPPED on a wide screen, not a proportion of it", () => {
    // The distinction matters: a proportional width on a desktop reserves 300+
    // px for a 144px tooltip and pushes it needlessly far from the cursor, and
    // a fraction that happens to equal the cap at 1024 would pass a
    // `toBe(224)`. Two widths that must agree is the claim itself.
    expect(widthAt(1440)).toBe(widthAt(1024));
    expect(widthAt(1024)).toBeLessThan(1024);
  });

  test("shrinks to the margins on a screen without room for the cap", () => {
    // A 200px-wide screen has 184px between the margins. Reserving the full cap
    // there would make the clamp unsatisfiable and the maths would silently
    // pick a side.
    expect(widthAt(200)).toBe(200 - 2 * MARGIN);
    expect(widthAt(200)).toBeLessThan(widthAt(1024));
  });

  test("never goes negative on a zero-width first frame", () => {
    expect(widthAt(0)).toBe(0);
  });
});

describe("horizontally", () => {
  test("a fine pointer keeps the tooltip beside the cursor", () => {
    const p = place(60, 100, false);
    expect(p.x).toBeGreaterThan(60);
    expect(p.x - 60).toBeLessThanOrEqual(MAX_CURSOR_GAP);
  });

  test("a coarse pointer centres it on the touch, so the finger covers no digits", () => {
    const p = place(160, 100, true);
    const box = viewportBox(p);
    expect((box.left + box.right) / 2).toBeCloseTo(CHART.containerLeft + 160, 5);
  });

  test("the reported bug: mid-plot on a phone no longer leaves the screen", () => {
    // Pointer at 50% of the measured 332px plot — the sample that measured
    // left: -53 at HEAD.
    const box = viewportBox(place(166, 100, true));
    expect(box.left).toBeGreaterThanOrEqual(MARGIN);
    expect(box.right).toBeLessThanOrEqual(PHONE.viewportWidth - MARGIN);
  });

  test.each([0, 6, 50, 166, 282, 326, 332])(
    "stays inside both viewport edges at plot x %i",
    (pointerX) => {
      for (const coarse of [false, true]) {
        const box = viewportBox(place(pointerX, 100, coarse));
        expect(box.left).toBeGreaterThanOrEqual(MARGIN);
        expect(box.right).toBeLessThanOrEqual(PHONE.viewportWidth - MARGIN);
      }
    },
  );

  test("clamps in VIEWPORT space, not in the chart's own box", () => {
    // A chart inset 29px from the left: a tooltip pinned to the screen margin
    // has to sit at a NEGATIVE container offset. Clamping to the container
    // would leave 29px of avoidable gutter and, on a chart wider than the
    // screen, would not clamp at all.
    const p = place(0, 100, true);
    expect(p.x).toBe(MARGIN - CHART.containerLeft);
    expect(p.x).toBeLessThan(0);
  });
});

describe("vertically", () => {
  test("a coarse pointer puts the whole box clear above the touch", () => {
    const p = place(160, 400, true);
    // `bottom-left` anchors the box's BOTTOM at y, which is what makes the
    // clearance exact without ever measuring the height.
    expect(p.anchor).toBe("bottom-left");
    expect(400 - p.y).toBeGreaterThanOrEqual(FINGER_CLEARANCE);
  });

  test("and flips below when the touch is near the top of the screen", () => {
    // A chart 20px down the page, touched 10px into it: 30px from the top of
    // the viewport, where the clearance plus the budget cannot fit above.
    const p = placeTooltip({
      ...PHONE,
      containerLeft: CHART.containerLeft,
      containerTop: 20,
      pointerX: 160,
      pointerY: 10,
      coarse: true,
    });
    expect(p.anchor).toBe("top-left");
    expect(p.y - 10).toBeGreaterThanOrEqual(FINGER_CLEARANCE);
    expect(p.y + 20).toBeGreaterThanOrEqual(MARGIN);
  });

  test("a fine pointer keeps the landed below-the-cursor placement", () => {
    const p = place(160, 100, false);
    expect(p.anchor).toBe("top-left");
    expect(p.y).toBeGreaterThan(100);
    expect(p.y - 100).toBeLessThanOrEqual(MAX_CURSOR_GAP);
  });

  test("and flips above only when below would leave the screen", () => {
    const p = placeTooltip({
      ...PHONE,
      ...CHART,
      pointerX: 160,
      pointerY: PHONE.viewportHeight - CHART.containerTop - 10,
      coarse: false,
    });
    expect(p.anchor).toBe("bottom-left");
    expect(viewportBox(p).bottom).toBeLessThanOrEqual(PHONE.viewportHeight - MARGIN);
  });

  test.each([0, 40, 120, 300, 520])(
    "keeps a budget-tall box on screen at plot y %i",
    (pointerY) => {
      for (const coarse of [false, true]) {
        const box = viewportBox(place(160, pointerY, coarse));
        expect(box.top).toBeGreaterThanOrEqual(MARGIN);
        expect(box.bottom).toBeLessThanOrEqual(PHONE.viewportHeight - MARGIN);
      }
    },
  );
});

describe("the position is a pure function of the pointer", () => {
  test("so a pointer held still cannot move it", () => {
    // The double-measure design this replaces re-entered its own input. Same
    // arguments, same answer, forever — which is the property that makes the
    // browser spec's "held still" assertion true by construction.
    const once = place(120, 240, true);
    const twice = place(120, 240, true);
    expect(twice).toEqual(once);
  });
});
