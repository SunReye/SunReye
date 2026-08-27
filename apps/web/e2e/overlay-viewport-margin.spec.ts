/**
 * An overlay never touches the edge of the screen.
 *
 * bits-ui resolves collisions with `collisionPadding`, and its default is
 * zero — so a popover anchored to a control in the page gutter flips or shifts
 * until it is flush against the viewport, where the shadow and the rounded
 * corner are cut in half and the first character starts one pixel in. At 390px
 * the range picker's calendar is wider than the gutter allows, so it is the
 * overlay that hits both edges at once.
 *
 * This is a BROWSER claim, not a source claim. The number only exists once
 * floating-ui has measured the anchor, the boundary and the content and picked
 * a side; a Tailwind inset would be invisible to that pass and would move the
 * box after the collision was already resolved. The unit suite owns the token
 * (`src/lib/layout/tokens.test.ts`, TOOLTIP_VIEWPORT_MARGIN); only a laid-out
 * document can say whether the token reached the position.
 *
 * Watched fail: with `popover-content.svelte` at HEAD (no `collisionPadding`)
 * the same gestures measure gapLeft 0px, gapRight 0.12px.
 */

import { expect, test, type Page } from "@playwright/test";
import { openPage, openRangePicker } from "./support/open-page";

/** The phone the dashboard is read on. */
const PHONE = { width: 390, height: 844 };

/**
 * The margin, restated rather than imported. This spec is the independent
 * measurement of the token that claims the margin, and importing the claim to
 * check the claim would let the two move together.
 */
const VIEWPORT_MARGIN_PX = 8;

/** How close the open popover got to each side of the viewport, in CSS px. */
async function viewportGaps(page: Page): Promise<{ left: number; right: number }> {
  const content = page.locator("[data-slot=popover-content]").first();
  await expect(content).toBeVisible();
  return content.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: window.innerWidth - box.right };
  });
}

test("a popover pinned to a phone gutter holds itself off both viewport edges", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openPage(page, "/#/statistics");
  await openRangePicker(page);

  const gaps = await viewportGaps(page);
  console.log(`popover gaps at ${PHONE.width}px: left ${gaps.left}px, right ${gaps.right}px`);

  // `>=` and not an equality: floating-ui is free to prefer a side that leaves
  // MORE room. What it must never do is spend less than the margin.
  expect(gaps.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN_PX);
  expect(gaps.right).toBeGreaterThanOrEqual(VIEWPORT_MARGIN_PX);
});
