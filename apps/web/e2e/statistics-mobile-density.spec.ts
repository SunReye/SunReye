/**
 * What a statistics tile actually gets to say on a phone.
 *
 * The unit test next to the tokens (`src/lib/layout/tokens.test.ts`,
 * `tileContentWidthPx`) computes this number from the class strings. That is
 * the right place for the DECISION, and it is worth nothing on its own: the
 * chain it models is four nested boxes deep, box-sizing and a negative margin
 * are involved, and a token can be perfectly correct while a `sm:` utility
 * loses the cascade to the base one it was meant to override. Only a browser
 * that lays the page out can say which declaration won.
 *
 * So both passes here measure a REAL tile:
 *
 *  - at 390x844, that the content box cleared the 150px floor;
 *  - at 1024x768, that the nested frame is still drawn — same 1px border, same
 *    16px cell gutter, no bleed. Without the second pass "delete the border
 *    everywhere" passes the first one.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { openPage } from "./support/open-page";

/** The phone the dashboard is read on, and the tablet the suite defaults to. */
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1024, height: 768 };

/**
 * The floor, restated here rather than imported: this spec is the independent
 * measurement of the very token that claims it, and importing the claim to
 * check the claim would make the two move together.
 */
const TILE_CONTENT_FLOOR_PX = 150;

function tiles(page: Page): Locator {
  return page.locator("[data-slot=stat-tile]");
}

/** A laid-out element's content box width: `clientWidth` is padding-box. */
function contentWidth(tile: Locator): Promise<number> {
  return tile.evaluate((el) => {
    const style = getComputedStyle(el);
    return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
}

/** The grid's own chrome, as the browser resolved it. */
function frameMetrics(grid: Locator) {
  return grid.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      marginLeft: parseFloat(style.marginLeft),
      marginRight: parseFloat(style.marginRight),
      borderLeft: parseFloat(style.borderLeftWidth),
      borderTop: parseFloat(style.borderTopWidth),
    };
  });
}

/** Open /statistics with a viewport set BEFORE the first layout. */
async function openStatistics(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  const opened = await openPage(page, "/#/statistics");
  const tile = tiles(page).first();
  await expect(tile).toBeVisible();
  return opened;
}

test("a stat tile on a 390px phone has room for its figure", async ({ page }) => {
  await openStatistics(page, PHONE);

  // Two-up, or the floor is met by stacking — which is the layout this
  // vocabulary exists to prevent (31 tiles, one to a row, 1400px of page).
  const boxes = await tiles(page).evaluateAll((els) =>
    els.slice(0, 2).map((el) => el.getBoundingClientRect()),
  );
  expect(boxes).toHaveLength(2);
  expect(boxes[0].top).toBeCloseTo(boxes[1].top, 0);
  expect(boxes[1].left).toBeGreaterThan(boxes[0].left);

  const width = await contentWidth(tiles(page).first());
  console.log(`tile content box at ${PHONE.width}px, two-up: ${width}px`);
  expect(width).toBeGreaterThanOrEqual(TILE_CONTENT_FLOOR_PX);
});

test("a laptop keeps the nested frame the phone gave up", async ({ page }) => {
  await openStatistics(page, LAPTOP);

  // The saving is a phone saving. If it reached this width the fix was
  // "delete the border", which is a different change nobody asked for.
  expect(await frameMetrics(page.locator("[data-slot=stat-tiles]").first())).toEqual({
    marginLeft: 0,
    marginRight: 0,
    borderLeft: 1,
    borderTop: 1,
  });

  const padding = await tiles(page)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(padding).toBe(16);
});
