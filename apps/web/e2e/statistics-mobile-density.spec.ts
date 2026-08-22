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

/**
 * Where a chart panel's controls land.
 *
 * The header is one `flex-wrap` row, so before this the placement depended on
 * whether the title happened to leave room: "Energy split" is short and its
 * controls sat beside it, right-aligned; "Hour of the week" and "2026 versus
 * last year" pushed theirs onto a second line, where `justify-between` with a
 * single child on it left them at the LEFT. Three panels on one page, three
 * placements, none of them chosen.
 *
 * Measured rather than asserted on classes because the whole defect was a
 * cascade/wrap interaction: the utilities were already "right", and where the
 * box ended up was decided by the length of a translated title.
 */
test("every chart panel puts its controls on the same centred row on a phone", async ({ page }) => {
  await openStatistics(page, PHONE);

  const clusters = await page.evaluate(() => {
    const out: { title: string; centred: boolean; ownRow: boolean; fillsRow: boolean }[] = [];
    // `data-slot` rather than a shape heuristic: the cluster is one div among
    // several in the header row, and guessing which by child count broke the
    // moment the caret moved out of it.
    for (const cluster of document.querySelectorAll("[data-slot=section-actions]")) {
      if (cluster.children.length === 0) continue; // rendered empty: not a panel
      const row = cluster.parentElement;
      if (!row) continue;
      const c = cluster.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      out.push({
        title: (row.querySelector("h2")?.textContent ?? "").trim(),
        centred: Math.abs(c.left - r.left - (r.right - c.right)) < 3,
        ownRow: Math.round(c.top) > Math.round(r.top) + 4,
        fillsRow: Math.round(c.width) === Math.round(r.width),
      });
    }
    return out;
  });

  // Four panels carry controls; if that count changes this should be re-read,
  // not relaxed.
  expect(clusters.length).toBeGreaterThanOrEqual(3);
  for (const cluster of clusters) {
    expect(cluster, `panel: ${cluster.title}`).toMatchObject({
      centred: true,
      ownRow: true,
      fillsRow: true,
    });
  }
});

/**
 * The other half of the same complaint: the period navigator was full-measure on
 * /statistics and content-width on /history, from identical markup. The toolbar
 * cluster is a flex item, so shrink-to-fit made the navigator's own `w-full`
 * resolve against the cluster's CONTENT width — wide on /statistics, where two
 * more controls widened it, and narrow on /history where it was the only child.
 *
 * Asserted against the SHELL MEASURE, not by comparing the two pages to each
 * other. Comparing them was tried and it could not fail: the effect is
 * locale-dependent, because what widened the /statistics cluster was the compare
 * switcher's own labels. In German ("Vorheriger Zeitraum", "Vor einem Jahr")
 * that is wide enough to stretch the navigator noticeably — which is how the bug
 * was reported — while the English the mock runs in is narrow enough that both
 * pages agreed with the fix reverted. The requirement is "fills the measure on a
 * phone", so that is what this measures, on each page independently.
 */
test("the period navigator fills the phone's measure on every page that carries it", async ({
  page,
}) => {
  for (const route of ["/#/statistics", "/#/history"]) {
    // Viewport BEFORE the first layout, like openStatistics does — `openPage`
    // takes no viewport, and passing one silently left this at the 1024 default.
    await page.setViewportSize(PHONE);
    await openPage(page, route);
    await expect(page.locator("[data-slot=period-navigator]").first()).toBeVisible();
    // `data-slot` and not `getByRole("group")`: /statistics carries a second
    // group (the compare-mode switcher), so the role locator measured whichever
    // came first.
    const measured = await page
      .locator("[data-slot=period-navigator]")
      .first()
      .evaluate((el) => {
        const shell = el.closest("[data-slot=page-shell]") ?? document.body;
        const style = getComputedStyle(shell);
        const measure =
          shell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return {
          navigator: Math.round(el.getBoundingClientRect().width),
          measure: Math.round(measure),
        };
      });
    expect(measured.navigator, `route: ${route}`).toBe(measured.measure);
  }
});
