/**
 * A chart tooltip never leaves the screen, and never hides under the finger.
 *
 * Reported from a phone on /statistics: the tooltip is clipped off the LEFT
 * edge, and it sits under the touch point so the hand covers the numbers.
 *
 * Watched fail — this sweep against HEAD (LayerChart positioning the box itself,
 * `x='pointer'` with `contained='container'`) at 390x844:
 *
 *   chart 0 frac 0.5: {"l":-53,"r":188,...} OVERFLOW 53
 *   chart 1 frac 0.5: {"l":-36,"r":188,...} OVERFLOW 36
 *   chart 2 frac 0.5: {"l":-27,"r":188,...} OVERFLOW 27
 *   chart 7 frac 0.85: {"l":-14,"r":302,...} OVERFLOW 14
 *
 * The cause is that LayerChart's containment only FLIPS the box to the other
 * side of the pointer and never clamps the result, so a 241px-wide tooltip
 * flipped left of a pointer 195px into a 390px screen goes off the edge.
 *
 * A BROWSER claim, not a source one: the arithmetic is unit-tested
 * (`src/lib/charts/tooltip-placement.test.ts`) and is worth nothing until a
 * laid-out document says how wide the real tooltips came out on the real
 * charts. The unit suite owns the rule; only this can measure the box.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { openPage } from "./support/open-page";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1024, height: 768 };

/**
 * The margin and the finger clearance, restated rather than imported: this spec
 * is the independent measurement of the very tokens that claim them, and
 * importing the claim to check the claim would let the two move together.
 *
 * The clearance floor is deliberately WEAKER than the 56px the source spends —
 * 40px is a fingertip. Tuning the gap up or down inside that stays a design
 * choice; closing it is the reported bug.
 */
const VIEWPORT_MARGIN_PX = 8;
const FINGER_CLEARANCE_PX = 40;

/** Fractions of the plot's width to sample. 50% and 85% are the reported reds. */
const SAMPLES = [0.02, 0.15, 0.5, 0.85, 0.98] as const;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The portalled tooltip's box, or `null` while there is no tooltip to measure.
 *
 * One `page.evaluate` over `document`, not a Playwright locator: the box is
 * read at the two samples in the axis gutter, where `TooltipContext` is in the
 * middle of HIDING the tooltip, and a locator resolved a frame before the
 * element detached reports a 0×0 rect at the document origin — which is
 * indistinguishable from "the placement put it off the left edge" and is what
 * made a 1024px sweep fail with `left: 0` on a different chart each run.
 *
 * `null` therefore means one of two legal things: no tooltip, or one on its way
 * out. `placed` is the third state and is the only one that is a bug: an element
 * with a size and no position. LayerChart seeds its position motion at `null`
 * (`createMotion(null, …)`), so `left`/`top` are the literal string "nullpx"
 * for the frame between mounting and the motion's first effect — real, but one
 * frame, so it is waited out rather than asserted on.
 */
async function tooltipBox(page: Page): Promise<Box | null> {
  const read = () =>
    page.evaluate(() => {
      const el = document.querySelector(".lc-tooltip-root");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        box: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
        sized: b.width > 0 && b.height > 0,
        placed: style.left !== "auto" && style.top !== "auto",
      };
    });

  let seen = await read();
  for (let i = 0; i < 10 && seen?.sized && !seen.placed; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    seen = await read();
  }
  if (!seen?.sized) return null;
  expect(seen.placed, "the tooltip has a size but no position").toBe(true);
  return seen.box;
}

function expectInsideViewport(box: Box, size: { width: number; height: number }, where: string) {
  expect(box.left, `${where}: off the left edge`).toBeGreaterThanOrEqual(VIEWPORT_MARGIN_PX);
  expect(box.right, `${where}: off the right edge`).toBeLessThanOrEqual(
    size.width - VIEWPORT_MARGIN_PX,
  );
  expect(box.top, `${where}: off the top edge`).toBeGreaterThanOrEqual(VIEWPORT_MARGIN_PX);
  expect(box.bottom, `${where}: off the bottom edge`).toBeLessThanOrEqual(
    size.height - VIEWPORT_MARGIN_PX,
  );
}

/**
 * Hover every mounted chart at each sample and check the box, returning how
 * many tooltips were actually measured.
 *
 * 2% and 98% of the plot BOX land in the axis gutter, where LayerChart
 * deliberately shows nothing (`TooltipContext.showTooltip` hides when the
 * pointer is inside the padding) — so "no tooltip" is a legal answer at the
 * edges and the count is what stops the whole sweep passing vacuously.
 */
interface Sweep {
  /** Pointer positions that produced a tooltip and had it measured. */
  samples: number;
  /** How many distinct charts contributed at least one of those. */
  charts: number;
}

async function sweep(
  page: Page,
  charts: Locator,
  size: { width: number; height: number },
  label = "chart",
): Promise<Sweep> {
  await expect(charts.first()).toBeVisible();
  const total = await charts.count();
  const result: Sweep = { samples: 0, charts: 0 };

  for (let i = 0; i < total; i++) {
    const chart = charts.nth(i);
    await chart.scrollIntoViewIfNeeded();
    const plot = await chart.boundingBox();
    if (!plot || plot.width < 20 || plot.height < 20) continue;
    let hit = false;
    for (const frac of SAMPLES) {
      await page.mouse.move(plot.x + plot.width * frac, plot.y + plot.height / 2);
      const box = await tooltipBox(page);
      if (!box) continue;
      result.samples++;
      hit = true;
      expectInsideViewport(box, size, `${label} ${i} at ${frac * 100}% of ${size.width}px`);
    }
    if (hit) result.charts++;
  }
  return result;
}

const sweepCharts = (page: Page, size: { width: number; height: number }) =>
  sweep(page, page.locator(".lc-root-container"), size);

/**
 * Floors, so a sweep cannot pass by measuring nothing.
 *
 * Two of them because one is not enough: 15 samples is met by three charts, and
 * the three chart kinds on /statistics are three different LayerChart tooltip
 * paths — a point-scale line (`period-series-chart` drawing the ratio trend), a
 * band-scale bar (`yoy-chart`, and the same shell drawing the energy flows) and
 * a CANVAS band grid (`heat-grid`, whose tooltip resolves off
 * `tooltipContext={{ mode: 'band' }}` and has no SVG marks at all). The chart
 * floor is what keeps all three in the sweep; the heatmap gets its own case
 * below, because it is the one whose plot is short enough that the vertical
 * flip fires.
 */
const MIN_MEASURED = 15;
const MIN_CHARTS = 5;

/** The heatmap panel's chart. Scoped by the panel's own heading, not by index. */
function heatmapChart(page: Page): Locator {
  // `.last()`: the heatmap is a NESTED panel, so the energy section that
  // contains it also matches `has:` and would drag four sibling charts in. The
  // innermost match is the panel itself.
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Hour of the week", exact: true }) })
    .last()
    .locator(".lc-root-container");
}

test("every tooltip on /statistics stays on a 390px screen", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openPage(page, "/#/statistics");
  const measured = await sweepCharts(page, PHONE);
  console.log(`measured ${measured.samples} tooltips on ${measured.charts} charts at 390px`);
  expect(measured.samples).toBeGreaterThanOrEqual(MIN_MEASURED);
  expect(measured.charts).toBeGreaterThanOrEqual(MIN_CHARTS);
});

test("and on a 1024px one, where a wide tooltip has room to overhang", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await openPage(page, "/#/statistics");
  const measured = await sweepCharts(page, LAPTOP);
  console.log(`measured ${measured.samples} tooltips on ${measured.charts} charts at 1024px`);
  expect(measured.samples).toBeGreaterThanOrEqual(MIN_MEASURED);
  expect(measured.charts).toBeGreaterThanOrEqual(MIN_CHARTS);
});

/**
 * The canvas heatmap, named rather than left to the sweep's index.
 *
 * A different tooltip path from every other chart here: no SVG marks, so the
 * hovered datum comes from `tooltipContext={{ mode: 'band' }}` resolving the
 * pointer against two band scales. It is also the SHORTEST plot on the page,
 * which is what makes it the one where a box the height of the placement's
 * budget cannot fit above the touch and the vertical flip has to fire.
 */
for (const size of [PHONE, LAPTOP]) {
  test(`the canvas heatmap's tooltip stays on a ${size.width}px screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await openPage(page, "/#/statistics");
    const measured = await sweep(page, heatmapChart(page), size, "heatmap");
    console.log(`heatmap: ${measured.samples} tooltips at ${size.width}px`);
    // One chart, five samples, and the two in the axis gutter are allowed to
    // show nothing — so three is the whole of the plot's interior.
    expect(measured.charts).toBe(1);
    expect(measured.samples).toBeGreaterThanOrEqual(3);
  });
}

/**
 * The other pointer. The suite's default context has `hasTouch: true`, which
 * Chromium reports as `(pointer: coarse)` — so every case above exercises the
 * TOUCH placement (centred on the pointer, above it). A context without touch
 * is the only way to get `(pointer: fine)`; `Emulation.setEmulatedMedia` does
 * not emulate the pointer feature (measured: it leaves `(pointer: coarse)`
 * true). Without this case the desktop branch of the placement has no coverage
 * at all.
 */
test("the mouse placement is clamped too", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: false, viewport: LAPTOP });
  const page = await context.newPage();
  try {
    await openPage(page, "/#/statistics");
    // The context really is the other pointer. Asserted rather than assumed:
    // if `hasTouch: false` ever stopped flipping the media query, every case in
    // this file would silently be the touch branch again and the desktop
    // placement would be uncovered with the suite green.
    expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
    const measured = await sweepCharts(page, LAPTOP);
    console.log(`measured ${measured.samples} tooltips with a fine pointer`);
    expect(measured.samples).toBeGreaterThanOrEqual(MIN_MEASURED);
    expect(measured.charts).toBeGreaterThanOrEqual(MIN_CHARTS);
  } finally {
    await context.close();
  }
});

test("a held finger gets the numbers clear of its own hand, and they stay put", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openPage(page, "/#/statistics");
  const chart = page.locator(".lc-root-container").first();
  await chart.scrollIntoViewIfNeeded();
  const plot = (await chart.boundingBox())!;
  const touch = { x: plot.x + plot.width * 0.5, y: plot.y + plot.height * 0.5 };

  // A real held touch, not a tap: `page.touchscreen` only taps, and a tap ends
  // with a pointerleave that hides the tooltip again.
  const cdp = await page.context().newCDPSession(page);
  const at = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: at(touch.x, touch.y),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: at(touch.x + 1, touch.y),
  });

  const held = await tooltipBox(page);
  expect(held, "a held finger shows no tooltip at all").not.toBeNull();
  expectInsideViewport(held!, PHONE, "held touch");

  // Clear of the hand: the box is entirely above or entirely below the contact
  // point, by more than a fingertip.
  const gap = Math.max(touch.y - held!.bottom, held!.top - touch.y);
  console.log(`finger gap ${Math.round(gap)}px, box ${JSON.stringify(held)}`);
  expect(gap).toBeGreaterThanOrEqual(FINGER_CLEARANCE_PX);

  // And it settles. A measure → position → measure design drifts for as long as
  // the pointer is down (PR #60's failure class); a clamp on the pointer's own
  // numbers cannot.
  // Measured: with LayerChart's default `motion="spring"` this drifted
  // 83.53 -> 84 over the wait while the chart's own box stayed at x 29, so the
  // box was still in flight when the finger had already stopped. Exact
  // equality, not a tolerance: the point of a pure clamp is that the position
  // IS the arithmetic on the frame it is computed, and the wrapper turns the
  // spring off to make that true (see chart-tooltip-root.svelte).
  await page.waitForTimeout(600);
  const later = await tooltipBox(page);
  expect(later).toEqual(held);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
});
