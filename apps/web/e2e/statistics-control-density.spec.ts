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
 * The ceiling, re-measured at 390px after the four-zone migration: 71, which is
 * the same number as before it. Two movements cancelled, and neither is a reason
 * to relax anything:
 *
 *  - The migration MOVES controls, it does not remove them. A panel's figure and
 *    its window control left the header for the readout row above the plot; a
 *    thumb can reach exactly what it could reach before, in a better place.
 *  - The one real saving is the compact switcher. A switcher over more than
 *    three options now renders a NativeSelect on a phone and keeps its toggle
 *    row `hidden sm:flex`, so the heatmap's four metric buttons are ONE control
 *    here — the hidden row measures 0x0 and the census skips it, which is what
 *    the zero-box guard below is for. Three fewer reachable controls.
 *  - Against that, the total did not fall, so three controls this payload
 *    renders now were not on the page when 71 was last taken. The census is
 *    taken over whatever the payload offers, which is exactly why this is a
 *    ceiling; it was re-measured rather than widened, and it did not move.
 *
 * Deliberately a ceiling and not an equality: the count depends on which tiles
 * this payload makes available (six registries, capability-gated), so pinning it
 * exactly would make an unrelated tile a failure here. A floor comes with it — a
 * page that rendered nothing would otherwise pass. Where the controls SIT is not
 * this number's job and never was; that is
 * `e2e/panel-control-placement.spec.ts`, which measures the two edges at 360,
 * 768 and 1440.
 */
const CONTROL_CEILING = 71;
const CONTROL_FLOOR = 55;

/** Everything a thumb can operate, as the document lays it out. */
async function controlCensus(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll(
      // `[role=radio]` is here because the segmented switchers are real
      // ToggleGroups now: their options report as radios inside a radiogroup,
      // which is the group semantics a row of Buttons never had. Without it this
      // census silently stopped counting every switcher option on the page —
      // reading as a saving where nothing had actually gone away.
      "button, a[href], input, select, [role=button], [role=combobox], [role=tab], [role=radio]",
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
  // A radio, not a button: the compare switcher is a ToggleGroup, so its
  // options carry `role="radio"` inside a radiogroup.
  await expect(page.getByRole("radio", { name: "Year ago", exact: true })).toBeVisible();
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

test("a chart panel's header holds chrome only, and its data sits over the plot", async ({
  page,
}) => {
  await openStatistics(page);
  const panel = card(page, "Total cost");
  const row = header(panel);

  // NONE. This is the row the complaint was about and it carried four items — a
  // figure, a bucket chip, a span chip and the ⤢. Each left for a different
  // reason: the two chips because a bucket is not a choice (one grain per
  // period), the figure and the window control because they are the panel's own
  // data rather than chrome, and the ⤢ last of all, because in a cluster it sat
  // one 44px box from the collapse caret and the two were mispressed. It is in
  // the plot's bottom-right corner now — `e2e/plot-corner-controls.spec.ts`
  // measures where, this only states that the header is empty of it.
  await expect(row.getByRole("button")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Full screen" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Show 12 months" })).toHaveCount(0);
  await expect(row.locator("[data-slot=panel-figure]")).toHaveCount(0);

  // And exactly one of them exists on the panel, over the plot.
  await expect(panel.getByRole("button", { name: "Full screen" })).toHaveCount(1);

  // Both are the readout row now: the figure left, the control right, on one
  // line between the header and the plot.
  const readout = panel.locator("[data-slot=panel-readout-row]").first();
  const figure = readout.locator("[data-slot=panel-figure]").first();
  const toggle = readout.getByRole("button", { name: "Show 12 months" });
  await expect(figure).toBeVisible();
  await expect(toggle).toBeVisible();

  const figureBox = await figure.boundingBox();
  const toggleBox = await toggle.boundingBox();
  const plotBox = await panel.locator("[data-slot=chart]").first().boundingBox();
  const rowBox = await row.boundingBox();
  expect(figureBox!.y).toBeGreaterThan(rowBox!.y);
  expect(figureBox!.y).toBeLessThan(plotBox!.y);

  // At 390px the row STACKS — `readoutRowClass()` drops to one column below
  // `sm`, unconditionally, rather than letting content decide. That is the whole
  // point of the token: "does it happen to fit" is the question that produced
  // three placements from one component, so the answer is the same width-driven
  // one whatever the strings are. The claim at phone width is therefore that the
  // control sits BELOW the figure and both start at the same left edge — stacked
  // and left-aligned, never centred.
  expect(toggleBox!.y).toBeGreaterThan(figureBox!.y);
  expect(Math.abs(toggleBox!.x - figureBox!.x)).toBeLessThan(1);

  // From `sm` the two share one line, figure left of control.
  await page.setViewportSize({ width: 1024, height: 768 });
  const wideFigure = await figure.boundingBox();
  const wideToggle = await toggle.boundingBox();
  expect(wideFigure!.x).toBeLessThan(wideToggle!.x);
  expect(Math.abs(wideFigure!.y - wideToggle!.y)).toBeLessThan(wideFigure!.height);
});

test("the comparison reference is a page control, not a section's", async ({ page }) => {
  await openStatistics(page);

  // It re-bases every section's delta chips, so it belongs above all of them —
  // in the toolbar, beside the navigator that picks the window it measures.
  const compare = page.getByRole("radio", { name: "Previous period", exact: true });
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
  // In the readout row, not the header: a text-labelled choice about the plot is
  // the panel's own data, not chrome. See the previous test.
  const toggle = panel
    .locator("[data-slot=panel-readout-row]")
    .first()
    .getByRole("button", { name: /^Show / });

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

    // In the plot's corner, not the header — see the previous test.
    await panel.getByRole("button", { name: "Full screen" }).click();
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

test("the desktop toolbar is one line of controls that share a baseline", async ({ page }) => {
  // Reported on a 1440px /statistics: the navigator was a two-row block (tabs
  // over stepper) beside a one-row compare switcher and a one-row gear, so
  // three peers on one line had three heights and nothing lined up. The stack
  // is the PHONE answer — four tabs and a stepper do not share 358px — and a
  // laptop has the width to spend.
  //
  // Two separate things had to be true, and the first alone was not enough:
  // the navigator became one row (34px) while the switcher carries `p-1` (38px),
  // which still left a 2px step at each end of the row.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, "/#/statistics");

  const peers = await page.locator("[data-slot=page-shell] .ml-auto > *").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return {
        slot: el.getAttribute("data-slot") ?? el.tagName.toLowerCase(),
        top: Math.round(box.top),
        height: Math.round(box.height),
      };
    }),
  );

  // The navigator plus at least the compare switcher; the gear is admin-only.
  expect(peers.length).toBeGreaterThan(1);
  // `.size`, not `toHaveLength`: a Set has no `length`, so `toHaveLength(1)`
  // fails even on a one-element Set and the message reads like a real defect.
  expect(new Set(peers.map((p) => p.height)).size, `heights: ${JSON.stringify(peers)}`).toBe(1);
  expect(new Set(peers.map((p) => p.top)).size, `tops: ${JSON.stringify(peers)}`).toBe(1);
});
