/**
 * The source menu: the plant, or one of its devices, chosen once in the SIDEBAR
 * header and followed by every read (#202, moved there by #215).
 *
 * A browser claim because what is under test is the wiring of a running
 * document: a control in the shell, a store behind it, and the query string of
 * requests other components issue. The vocabulary (`$lib/source.ts`, including
 * `sourceMenu`) is proven in milliseconds; only whether a click here changes
 * the requests there exists in a browser.
 *
 * The 400px case is the #215 regression itself. The control used to live in the
 * page header, where a plant of two devices — exactly three options, one under
 * `needsCompactSwitcher`'s `> 3` — got the segmented `ToggleGroup`, whose items
 * are `shrink-0 whitespace-nowrap` inside a header that does not clip. The page
 * then scrolled sideways. `scrollWidth <= innerWidth` is the whole bug.
 */

import { expect, type Locator, type Page, test } from "@playwright/test";
import { SOURCES_TWO } from "./support/api-fixtures";
import { openPage } from "./support/open-page";

/** A phone narrow enough that the old segmented switcher ran off it. */
const PHONE = { width: 400, height: 844 };

/** The source menu's trigger, in the sidebar header. */
const menuButton = (page: Page) => page.locator("[data-source-switcher]");

/**
 * Open the sidebar sheet and return the source menu's trigger.
 *
 * The sidebar is an overlay on every viewport in this app
 * (`ui/sidebar/context.svelte.ts`), so the menu is only on screen once the
 * header's trigger has opened it.
 */
async function openSidebar(page: Page): Promise<Locator> {
  await page.locator("[data-slot=sidebar-trigger]").click();
  const button = menuButton(page);
  await expect(button).toBeVisible();
  // Geometry and open-state assertions below need CSS to have APPLIED, not just
  // the element to be visible: unstyled, every div is `display: block` and the
  // reading is byte-identical to a real layout regression. `flex` is the
  // button's display at every breakpoint, so this waits without pinning one.
  await expect(button).toHaveCSS("display", "flex");
  return button;
}

/** The open menu's options. */
const options = (page: Page) => page.getByRole("menuitemradio");

test("a single-device plant names the plant on a button that does not open a menu", async ({
  page,
}) => {
  const opened = await openPage(page, "/#/statistics");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const button = await openSidebar(page);
  // The same row everywhere: brand on line one, source on line two.
  await expect(button).toContainText("SunReye");
  await expect(button).toContainText("Plant");
  // Non-interactive: no menu to open, and no chevron promising one.
  await expect(button).not.toHaveAttribute("aria-haspopup", "menu");
  await button.click({ force: true });
  await expect(options(page)).toHaveCount(0);

  // Every series read still names its source — the plant, the default.
  await expect.poll(() => opened.backend.requestCount(/source=plant/)).toBeGreaterThan(0);
  expect(opened.backend.requestCount(/source=(?!plant)/)).toBe(0);
  expect(opened.consoleErrors).toEqual([]);
});

test("a two-inverter plant opens a menu, and choosing a device re-scopes the reads", async ({
  page,
}) => {
  const opened = await openPage(page, "/#/statistics", { sources: SOURCES_TWO });

  const button = await openSidebar(page);
  await expect(button).toContainText("Plant");
  await button.click();

  // Plant first, then the devices in roster order — `sourceOptions`, rendered.
  await expect(options(page)).toHaveText(["Plant", "East roof", "West roof"]);
  // Exactly one mark, on the source in use.
  await expect(page.getByRole("menuitemradio", { checked: true })).toHaveText(["Plant"]);

  await expect.poll(() => opened.backend.requestCount(/source=plant/)).toBeGreaterThan(0);
  opened.backend.resetRequests();

  await page.getByRole("menuitemradio", { name: "West roof" }).click();
  // The statistics page refetches under the device — and nothing under the plant.
  await expect.poll(() => opened.backend.requestCount(/source=west/)).toBeGreaterThan(0);
  expect(opened.backend.requestCount(/source=plant/)).toBe(0);
  // The trigger's second line follows the choice.
  await expect(menuButton(page)).toContainText("West roof");

  // The choice survives a reload.
  await page.reload();
  const reopened = await openSidebar(page);
  await expect(reopened).toContainText("West roof");
  await reopened.click();
  await expect(page.getByRole("menuitemradio", { checked: true })).toHaveText(["West roof"]);
  expect(opened.consoleErrors).toEqual([]);
});

test("a 400px phone with three sources does not scroll sideways", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const opened = await openPage(page, "/#/statistics", { sources: SOURCES_TWO });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The stylesheet, not just the element: an unstyled document does not overflow
  // for the reason this case is about, so it would pass green and prove nothing.
  await expect(page.locator("header").first()).toHaveCSS("display", "flex");

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

  // …and the header is not merely clipping it: the control is in the sidebar.
  await expect(menuButton(page)).toHaveCount(0);
  const button = await openSidebar(page);
  await expect(button).toBeVisible();
  expect(opened.consoleErrors).toEqual([]);
});
