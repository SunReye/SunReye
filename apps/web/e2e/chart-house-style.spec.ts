/**
 * That the energy chart draws BARS, in the document, with the real renderer.
 *
 * kWh accrued over a bucket is not a rate between two instants. Drawn as a line
 * the chart states a slope it does not have: between Monday's 14 kWh and
 * Tuesday's 3 kWh it paints every value in between as if the plant had passed
 * through them, and the eye reads the area under that line as a total. It plots
 * `period-series-chart` — the same shell the ratio trend uses — so "which mark"
 * is a decision the house-style table makes from the KIND, and the unit test on
 * that table cannot see whether the decision reached a canvas.
 *
 * No screenshot. Both charts here render through `layerchart/canvas` (a year by
 * day is hundreds of points across six series, far past the band count where
 * the SVG context freezes weak devices), so there are no DOM marks to query —
 * and a pixel comparison would fail for a palette change and pass for a chart
 * drawn one mark short. What is asserted instead is the DRAWING CALLS: a bar is
 * a filled rect, a line is a stroked path, and layerchart's canvas renderer
 * reaches `fillRect` only through `<Rect>` (utils/canvas.js `renderRect`) and
 * `stroke(path)` only through `<Path>`. Counting them per canvas says which
 * mark was drawn without caring what colour it came out.
 *
 * The same instrument answers the second question: with what WEIGHT. The house
 * has exactly one stroke weight (`MARK_STYLE[kind].strokeWidth`), and a canvas
 * mark that is never handed one is drawn at whatever LayerChart's own `.lc-path`
 * probe resolves — so a chart can spend the table's curve and its mark and still
 * come out a weight nobody chose. `ctx.lineWidth` at the moment of `stroke()` is
 * that weight, in device-independent px, after the cascade.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { openPage } from "./support/open-page";
// The expectation is DERIVED from the table, not restated beside the assertion:
// a weight that changes in one place must not need editing in two, and a weight
// nobody spends can then never look like the house one.
import { MARK_STYLE } from "../src/lib/charts/house-style";

/** Two viewports, because the bar layout is the thing most likely to collapse
 *  on the narrow one — a grouped band that rounds to zero width draws nothing
 *  and reports no error. */
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 900 };

/**
 * Tally of the canvas operations that distinguish a bar from a line, plus the
 * weight every stroked path came out at.
 *
 * `strokeWidths` is a count per weight rather than a set: "the house weight
 * appears somewhere on this canvas" stays green while one of two series lines
 * is drawn at the default, and two lines at two weights is the exact defect.
 */
type Ops = { filledRects: number; strokedPaths: number; strokeWidths: Record<string, number> };

/**
 * Count filled rects and stroked paths per canvas, from before the first paint.
 *
 * Installed on the prototype so it sees every context the app creates, and the
 * tallies live on the canvas ELEMENT — a page-wide counter cannot say which of
 * the four charts on /statistics drew what, which is the whole question.
 */
async function countCanvasOps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const opsOf = (canvas: HTMLCanvasElement): Ops => {
      const store = (canvas as unknown as { __ops?: Ops }).__ops ?? {
        filledRects: 0,
        strokedPaths: 0,
        strokeWidths: {},
      };
      (canvas as unknown as { __ops?: Ops }).__ops = store;
      return store;
    };
    const tally = (canvas: HTMLCanvasElement, key: "filledRects" | "strokedPaths") => {
      opsOf(canvas)[key]++;
    };
    const realFillRect = proto.fillRect;
    proto.fillRect = function (...args: Parameters<typeof realFillRect>) {
      tally(this.canvas, "filledRects");
      return realFillRect.apply(this, args);
    };
    // A rounded rect takes the path branch instead; counted as a filled rect
    // because it is still a bar. Without this, giving the bars a corner radius
    // would silently empty the assertion.
    const realRoundRect = proto.roundRect;
    proto.roundRect = function (...args: Parameters<typeof realRoundRect>) {
      tally(this.canvas, "filledRects");
      return realRoundRect.apply(this, args);
    };
    const realStroke = proto.stroke;
    proto.stroke = function (...args: unknown[]) {
      tally(this.canvas, "strokedPaths");
      // The weight AS IT WILL BE PAINTED: `lineWidth` is whatever the renderer
      // last assigned from the mark's resolved style, so reading it here needs
      // no knowledge of how layerchart got there.
      const widths = opsOf(this.canvas).strokeWidths;
      const key = String(this.lineWidth);
      widths[key] = (widths[key] ?? 0) + 1;
      // @ts-expect-error — the overloads (no args, Path2D) are both forwarded.
      return realStroke.apply(this, args);
    };
  });
}

/** The chart canvas inside the panel that carries this heading. */
function panelCanvas(page: Page, heading: string): Locator {
  // `.last()`: an outer section that CONTAINS the panel also matches `has:`,
  // and would hand back a sibling panel's canvas. The innermost is the panel.
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .last()
    .locator("canvas")
    .first();
}

async function opsOf(canvas: Locator): Promise<Ops> {
  await expect(canvas).toBeVisible();
  return await canvas.evaluate(
    (el) =>
      (el as unknown as { __ops?: Ops }).__ops ?? {
        filledRects: 0,
        strokedPaths: 0,
        strokeWidths: {},
      },
  );
}

/** Panels on /statistics, by the heading the section header renders. */
const ENERGY_FLOWS = "Energy flows";
const RATIOS = "Self-sufficiency & self-consumption";

for (const size of [PHONE, LAPTOP]) {
  test(`the energy flows chart draws bars at ${size.width}px`, async ({ page }) => {
    await countCanvasOps(page);
    await page.setViewportSize(size);
    await openPage(page, "/#/statistics");

    const bars = await opsOf(panelCanvas(page, ENERGY_FLOWS));
    console.log(`energy flows at ${size.width}px: ${JSON.stringify(bars)}`);

    // One filled rect per bar. A line chart of the same rows reaches zero:
    // layerchart's canvas renderer only calls fillRect from `<Rect>`, and a
    // spline, a grid line and an axis rule are all stroked paths.
    expect(bars.filledRects).toBeGreaterThan(4);
  });
}

test("and the ratio trend beside it is still a line", async ({ page }) => {
  // The control group. Without it "make every canvas draw rects" passes the
  // case above, and the ratios — two shares that vary continuously between the
  // buckets — would become bars for no reason.
  await countCanvasOps(page);
  await page.setViewportSize(LAPTOP);
  await openPage(page, "/#/statistics");

  const line = await opsOf(panelCanvas(page, RATIOS));
  console.log(`ratio trend: ${JSON.stringify(line)}`);
  expect(line.filledRects).toBe(0);
  // And it did draw something: a spline is a stroked path, so zero here would
  // mean an empty plot passing as "not bars".
  expect(line.strokedPaths).toBeGreaterThan(0);
});

/**
 * Weights, sorted, as the renderer really set them — the diagnostic the
 * assertions below are read against, printed on every run so a change of
 * default in layerchart is visible rather than inferred.
 */
function weights(ops: Ops): number[] {
  return Object.keys(ops.strokeWidths)
    .map(Number)
    .sort((a, b) => a - b);
}

test("the ratio trend's lines are drawn at the house stroke weight", async ({ page }) => {
  // The house has ONE weight, and a line drawn at another implies an emphasis
  // nobody meant. `period-series-chart` spent the table's curve and its mark
  // but never its `strokeWidth`, so the two ratio lines came out at
  // layerchart's own `.lc-path` default — measured as 2 beside the grid's 1,
  // which is two weights on one chart.
  await countCanvasOps(page);
  await page.setViewportSize(LAPTOP);
  await openPage(page, "/#/statistics");

  const ops = await opsOf(panelCanvas(page, RATIOS));
  console.log(`ratio trend stroke widths: ${JSON.stringify(ops.strokeWidths)}`);

  const house = MARK_STYLE.overlay.strokeWidth;
  // BOTH lines, not "a line somewhere": one stroked path per series at the
  // house weight. A single-series pass is the half-applied state.
  expect(ops.strokeWidths[String(house)] ?? 0).toBeGreaterThanOrEqual(2);
  // And nothing on the canvas is drawn heavier than the house weight. The grid
  // is thinner by design; a heavier stroke is a mark that never asked the table.
  expect(weights(ops).filter((w) => w > house)).toEqual([]);
});
