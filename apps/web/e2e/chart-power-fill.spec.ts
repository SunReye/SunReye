/**
 * That the `power` fill is ONE drawing, in the document, with the real renderer.
 *
 * One instantaneous measure sampled over time is drawn the same way wherever it
 * appears: the metric's accent fading downward to transparent, at the house fill
 * opacity, with a solid line along its top edge. It was not always — the live
 * sparkline painted a flat 0.3 wash and the history card of the SAME metric a 0.9
 * gradient, so two views of one reading read as two different measures.
 *
 * The previous pass converged them by hand, and `fallow dupes` then reported the
 * two blocks as character-for-character identical — which is what "converged by
 * hand" means: one decision living in two files, waiting to drift back. They now
 * render one component (`power-area.svelte`); the census in
 * `src/lib/charts/house-style-wiring.test.ts` is what holds that.
 *
 * This is the half that census cannot see. Source text says which component the
 * charts render; only a browser says what came out of it — that the gradient is
 * really vertical, really fades to nothing, and that the numbers the table names
 * are the ones on the element. Both plots draw through layerchart's SVG context
 * (not the canvas one the statistics charts use), so their marks are real DOM and
 * can be read rather than inferred.
 *
 * No screenshot: a pixel comparison fails for a palette change and passes for an
 * area drawn at the wrong opacity.
 */

import { expect, test, type Page } from "@playwright/test";
import { openHistory, selectRange } from "./support/history";
// DERIVED from the table, never restated beside the assertion: an opacity that
// changes in one place must not need editing in two, and a value nobody spends
// can then never look like the house one.
import { MARK_STYLE } from "../src/lib/charts/house-style";

/** One drawn `power` fill, as the DOM carries it. */
type PowerFill = {
  /** `[offset, stop-color]` per gradient stop, in document order. */
  stops: [string, string][];
  /** Painted down the plot rather than across it. */
  vertical: boolean;
  /** `fill-opacity` on the area path that spends the gradient. */
  fillOpacity: string | null;
  /** `stroke` on the line drawn along the area's top edge. */
  lineStroke: string | null;
  /** `stroke-dasharray` on that line. */
  lineDash: string | null;
};

/**
 * Every `power` fill on the page.
 *
 * Discovered by the SHAPE of the gradient rather than by a selector on a chart:
 * two stops ending in `transparent` is the `power` mark, and the signed `flow`
 * mark beside it (battery and grid power) is four stops split at zero with no
 * transparent end — so a diverging card cannot be mistaken for a passing case,
 * and a plot that stops drawing the fade drops out of the sweep instead of
 * quietly satisfying it.
 */
async function powerFills(page: Page): Promise<PowerFill[]> {
  return await page.evaluate(() => {
    const found: PowerFill[] = [];
    for (const gradient of document.querySelectorAll("linearGradient")) {
      const stops: [string, string][] = [...gradient.querySelectorAll("stop")].map((stop) => [
        stop.getAttribute("offset") ?? "",
        stop.getAttribute("stop-color") ?? "",
      ]);
      if (stops.length !== 2 || stops[1]![1] !== "transparent") continue;
      // The area path is the element that spends this gradient; the outline is
      // its sibling (`lc-area-line`), which layerchart renders just before it.
      const area = document.querySelector(`[fill="url(#${gradient.id})"]`);
      const line = area?.parentElement?.querySelector("path.lc-area-line") ?? null;
      found.push({
        stops,
        vertical:
          gradient.getAttribute("x1") === gradient.getAttribute("x2") &&
          gradient.getAttribute("y1") !== gradient.getAttribute("y2"),
        fillOpacity: area?.getAttribute("fill-opacity") ?? null,
        lineStroke: line?.getAttribute("stroke") ?? null,
        lineDash: line?.getAttribute("stroke-dasharray") ?? null,
      });
    }
    return found;
  });
}

/**
 * The whole claim, applied to every fill drawn on the page.
 *
 * EVERY one, not "one of them somewhere": a page where three of four sparklines
 * fade and the fourth is a flat slab is the exact defect, and it passes any
 * assertion written over the first match.
 */
function expectHouseFill(fills: PowerFill[], where: string): void {
  console.log(`${where}: ${JSON.stringify(fills)}`);
  expect(fills.length, `${where} drew no power fill at all`).toBeGreaterThan(0);
  for (const fill of fills) {
    // Down the plot: a horizontal fade would say the measure changes with the
    // time of day rather than with its own magnitude.
    expect(fill.vertical).toBe(true);
    // From the metric's own accent at the top to nothing at the baseline. The
    // first stop is pinned only as "a colour, and not the fade itself" — which
    // accent belongs to which metric is the palette's business, not this file's.
    expect(fill.stops[0]![0]).toBe("0");
    expect(fill.stops[0]![1]).not.toBe("");
    expect(fill.stops[0]![1]).not.toBe("transparent");
    expect(fill.stops[1]![0]).toBe("1");
    // The opacity the table owns, on the element that was drawn. This is the
    // number the two plots disagreed on (0.3 against 0.9).
    expect(fill.fillOpacity).toBe(String(MARK_STYLE.power.fillOpacity));
    // And the outline is there, in the metric's accent, solid. `stroke` and
    // `stroke-dasharray` are the two members of the treatment object that reach
    // an SVG path, so together they say `houseLine`'s result — and not a local
    // literal — is what drew this mark.
    //
    // NOT the weight: `houseLine` states it as the hyphenated `'stroke-width'`,
    // and layerchart's SVG `Path` assigns `stroke-width={strokeWidthProp}`
    // (camelCase) AFTER spreading the rest, so the house weight never lands on
    // an SVG mark at all — every one of these lines paints at the SVG default
    // 1px. Measured, reported, and deliberately not pinned here: asserting the
    // 1 would freeze the defect, and asserting the 1.5 would fail for a reason
    // this file did not cause. The canvas charts, which pass the weight
    // camelCase, are measured in `chart-house-style.spec.ts`.
    expect(fill.lineStroke).not.toBe(null);
    expect(fill.lineStroke).not.toBe("none");
    expect(fill.lineDash).toBe("none");
  }
}

/** Wait until at least one plot has built its marks — both branches mount lazily. */
async function waitForMarks(page: Page): Promise<void> {
  await expect(page.locator("linearGradient").first()).toBeAttached();
}

/**
 * Both cases run on /history, which is where the same metric is drawn BOTH ways:
 * a card on the live range glides `live-area`, and the same card on a fetched
 * window draws `metric-history-chart`. Two routes would have compared two
 * metrics; this compares the two renderings of one.
 */

test("the live sparkline draws the house power fill", async ({ page }) => {
  const backend = await openHistory(page);
  // Samples, so the plot has a series to fade under rather than an empty box.
  for (let i = 0; i < 4; i++) {
    await backend.pushMetrics();
    await page.waitForTimeout(150);
  }
  await waitForMarks(page);
  expectHouseFill(await powerFills(page), "live sparklines");
});

test("and the same card's historical area draws that same fill", async ({ page }) => {
  await openHistory(page);
  // Off the live range: the card's other branch, which is the one that used to
  // paint a 0.9 gradient while the sparkline above painted a flat 0.3 wash.
  await selectRange(page, "Last week");
  await waitForMarks(page);
  expectHouseFill(await powerFills(page), "history areas");
});
