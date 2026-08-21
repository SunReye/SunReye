/**
 * How many controls /statistics offers a phone, and where they sit.
 *
 * The complaint was "many buttons, it's confusing", and the screenshot behind it
 * was the TOTAL COST panel: one row carrying a figure ("€6.62 –"), a "By day"
 * chip, a "12 months" chip and a full-screen icon, with a legend under it. Four
 * items in one right-aligned cluster, all wearing the same weight, so a reader
 * counts four controls where there are two — and two of those chips answered
 * different questions ("how finely?" and "over what span?") in one switcher.
 *
 * Every claim here is a measurement rather than a source-text check, because
 * every one of them is about the laid-out document: which box a control ended up
 * in, whether it is visible at 390px at all, and what a full-screen expansion
 * actually gives the plot it expands. The census in particular cannot be read
 * off the sources — two thirds of these buttons are produced by six tile
 * registries and only the browser knows which of them this payload renders.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { openPage } from "./support/open-page";

/** The phone the dashboard is read on. */
const PHONE = { width: 390, height: 844 };

/**
 * The ceiling. 74 before this change, 71 after, and the three that went are the
 * two surplus scope chips and the full-screen control over the negative-window
 * LIST. Deliberately a ceiling and not an equality: the count depends on which
 * tiles this payload makes available (six registries, capability-gated), so
 * pinning it exactly would make an unrelated tile a failure here. A floor comes
 * with it — a page that rendered nothing would otherwise pass.
 */
const CONTROL_CEILING = 71;
const CONTROL_FLOOR = 55;

/** Everything a thumb can operate, as the document lays it out. */
async function controlCensus(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll(
      "button, a[href], input, select, [role=button], [role=combobox], [role=tab]",
    )) {
      const box = el.getBoundingClientRect();
      // `hidden sm:flex` renders BOTH forms of a compact switcher and lets CSS
      // choose; the invisible one is not a control the reader can reach.
      if (box.width === 0 && box.height === 0) continue;
      const label = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim();
      out.push(label.replace(/\s+/g, " "));
    }
    return out;
  });
}

/**
 * The section card whose OWN title is `title` — panels are section cards too,
 * nested inside another one, so a `filter({ has: heading })` matches the panel
 * and its parent both and `.first()` silently hands back the parent. The card's
 * own heading is `section > div > div > h2` (the header row, then the title
 * block); a descendant match cannot tell the two apart.
 */
function card(page: Page, title: string): Locator {
  return page.locator(`section:has(> div > div > h2:text-is("${title}"))`);
}

/** A section card's header row: the title block and the one action cluster. */
const header = (section: Locator): Locator => section.locator("> div").first();

async function openStatistics(page: Page) {
  await page.setViewportSize(PHONE);
  const opened = await openPage(page, "/#/statistics");
  // The comparison payload is what the tiles and the panel figures are built
  // from; nothing below is meaningful before it lands.
  await expect(page.getByRole("button", { name: "Year ago", exact: true })).toBeVisible();
  await expect(page.locator("[data-slot=panel-figure]").first()).toBeVisible();
  return opened;
}

test("the page offers a phone no more controls than it did before", async ({ page }) => {
  const opened = await openStatistics(page);

  const controls = await controlCensus(page);
  console.log(`/statistics controls at ${PHONE.width}px: ${controls.length}`);
  expect(controls.length).toBeGreaterThanOrEqual(CONTROL_FLOOR);
  expect(controls.length).toBeLessThanOrEqual(CONTROL_CEILING);

  // The bucket grammar is gone from the window control: one button, naming the
  // window it goes to. "By day" beside "12 months" is the row this replaced.
  await expect(page.getByRole("button", { name: "By day", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show 12 months", exact: true })).toHaveCount(2);

  expect(opened.consoleErrors).toEqual([]);
});

test("a chart panel's header holds its two controls and no data", async ({ page }) => {
  await openStatistics(page);
  const panel = card(page, "Total cost");
  const row = header(panel);

  // Two: the window control and the full-screen toggle. This is the row the
  // complaint was about, and it carried four items.
  await expect(row.getByRole("button")).toHaveCount(2);
  await expect(row.getByRole("button", { name: "Show 12 months" })).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Full screen" })).toHaveCount(1);

  // The figure is data. In the cluster it was the thing that made two controls
  // read as four, so it is in the body now — above the plot it describes.
  await expect(row.locator("[data-slot=panel-figure]")).toHaveCount(0);
  const figure = panel.locator("[data-slot=panel-figure]").first();
  await expect(figure).toBeVisible();

  const figureBox = await figure.boundingBox();
  const plotBox = await panel.locator("[data-slot=chart]").first().boundingBox();
  const rowBox = await row.boundingBox();
  expect(figureBox!.y).toBeGreaterThan(rowBox!.y);
  expect(figureBox!.y).toBeLessThan(plotBox!.y);
});

test("the comparison reference is a page control, not a section's", async ({ page }) => {
  await openStatistics(page);

  // It re-bases every section's delta chips, so it belongs above all of them —
  // in the toolbar, beside the navigator that picks the window it measures.
  const compare = page.getByRole("button", { name: "Previous period", exact: true });
  await expect(compare).toHaveCount(1);
  await expect(
    page.locator("section").filter({ has: compare }),
    "the compare switcher is still inside a section card",
  ).toHaveCount(0);

  // Above the first section card, not merely outside them: the toolbar is the
  // row the navigator is in, and this control measures the navigator's window.
  const compareBox = await compare.boundingBox();
  const firstCard = await card(page, "Costs & savings").boundingBox();
  expect(compareBox!.y).toBeLessThan(firstCard!.y);
});

test("the window control names where it goes, in both directions", async ({ page }) => {
  await openStatistics(page);
  const panel = card(page, "Total cost");
  const row = header(panel);
  const toggle = row.getByRole("button", { name: /^Show / });

  // The switcher this replaced showed "By day" beside "12 months" — a bucket
  // beside a span, with the lit chip the only clue which was drawn. One button
  // that names the OTHER window has no such state to read.
  await expect(toggle).toHaveText("12 months");
  await expect(panel).toContainText("Aug 2026, by day");

  await toggle.click();
  await expect(panel).toContainText("Last 12 months");
  await expect(toggle).toHaveText("Aug 2026");
  // The figure describes the PICKED window, so a chart zoomed out past it drops
  // the figure rather than standing over bars that disagree with it.
  await expect(panel.locator("[data-slot=panel-figure]")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveText("12 months");
  await expect(panel.locator("[data-slot=panel-figure]")).toHaveCount(1);
});

/**
 * The ceiling on the other side: what one full-screen control is for.
 *
 * These two are the reason the nine controls were NOT hoisted into the four
 * section headers, which would have removed five buttons. A control expands its
 * whole box, and `EXPANDED_SECTION` divides that box between every plot in it —
 * with the control on the section card, this phone gives Costs & savings 69px
 * for its one plot and Energy 0px for each of its four. On the panel, each plot
 * is the whole box.
 */
for (const panelTitle of ["Total cost", "Energy flows"]) {
  test(`${panelTitle} expands to one plot with the screen to itself`, async ({ page }) => {
    await openStatistics(page);
    const panel = card(page, panelTitle);
    const inPage = await panel.locator("[data-slot=chart]").first().boundingBox();

    await header(panel).getByRole("button", { name: "Full screen" }).click();
    const expanded = page.locator("section.fixed");
    await expect(expanded).toHaveCount(1);
    await expect(expanded.locator("[data-slot=chart]")).toHaveCount(1);

    const big = await expanded.locator("[data-slot=chart]").boundingBox();
    console.log(
      `${panelTitle}: ${Math.round(inPage!.height)}px in page, ${Math.round(big!.height)}px expanded`,
    );
    expect(big!.height).toBeGreaterThan(inPage!.height * 2.5);

    // Same button, back out again — the trigger travels with the card.
    await expanded.getByRole("button", { name: "Exit full screen" }).click();
    await expect(page.locator("section.fixed")).toHaveCount(0);
  });
}
