/**
 * A dialog on a phone: does its body scroll, does it stay inside the screen,
 * and can it still be closed once you are at the bottom of it.
 *
 * Three defects reported from a real phone, all of them properties of the
 * SHARED dialog primitive rather than of any one consumer:
 *
 *  1. The custom-chart editor capped itself at `90vh` and then hid its own
 *     overflow, so on a short screen the footer — the Save button — was
 *     clipped OUTSIDE the box and could not be tapped. A chart could be
 *     composed on a phone and never saved.
 *  2. A node dialog scrolled SIDEWAYS. `Dialog.Content` is a grid whose single
 *     `auto` column takes its minimum from its items' min-content, so one
 *     unbreakable child (the headline KPI row) widened the track past the
 *     box and the whole dialog gained a horizontal scroll.
 *  3. With the whole box scrolling, the title and the X scrolled away with it:
 *     at the bottom of a tall dialog there was nothing to close it with.
 *
 * This has to be a browser claim. Every one of these is a computed layout —
 * scrollWidth against clientWidth, a clipped footer, a sticky box measured
 * after a scroll — and none of them exists in the source text of the fix.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

/** A short phone: what is left of a 6" screen once the browser chrome has its share. */
const PHONE = { width: 390, height: 640 };
/** The narrow end of the phone range, where the grid track overflowed. */
const NARROW = { width: 344, height: 740 };

const dialog = (page: Page) => page.getByRole("dialog");

/**
 * Scroll the dialog the way a finger does — a wheel over the box, wherever the
 * scroll lives. Deliberately not `locator.hover()` (it waits on actionability
 * the dialog's own children fail) and not `scrollIntoView` (that scrolls an
 * `overflow: hidden` box no reader can move).
 */
async function wheelOver(page: Page, panel: ReturnType<typeof dialog>) {
  const box = (await panel.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height - 8, 40));

  // Wheel until the box stops moving, rather than one fixed delta. A single
  // 2000px notch is only "the bottom" for content that happens to be shorter
  // than that: the editor's height depends on how many series the fixture
  // draws, so a fixed delta left the footer 12px short on some runs and passed
  // on others. Reading the scroll offset back is what makes it deterministic.
  const offset = () =>
    panel.evaluate((el) => {
      const body = el.querySelector("[data-slot=dialog-body]");
      return (body ?? el).scrollTop;
    });

  let previous = -1;
  for (let i = 0; i < 12; i++) {
    const at = await offset();
    if (at === previous) return;
    previous = at;
    await page.mouse.wheel(0, 1_000);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  }
}

test("the custom-chart editor's Save button is reachable on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openPage(page, "/#/history");

  await page.getByRole("button", { name: "New chart" }).click();
  const panel = dialog(page);
  await expect(panel).toBeVisible();

  await panel.getByLabel("Name").fill("Phone chart");
  await panel.getByRole("checkbox").first().check();

  // A wheel, not `scrollIntoView`: an `overflow: hidden` box is still
  // scrollable programmatically, so Playwright's own actionability scroll
  // reaches a footer no finger ever could. What a phone can do is scroll.
  await wheelOver(page, panel);

  const save = panel.getByRole("button", { name: "Save", exact: true });
  const saveBox = await save.boundingBox();
  const panelBox = await panel.boundingBox();
  // Inside the dialog, therefore painted: the clipped footer sat below it.
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height + 1);
  await expect(save).toBeInViewport();

  await save.click({ timeout: 5_000 });
  await expect(panel).toHaveCount(0);
});

test("a node dialog never scrolls sideways", async ({ page }) => {
  await page.setViewportSize(NARROW);
  await openPage(page, "/#/");
  await page.getByRole("button", { name: "Battery details" }).click();

  const panel = dialog(page);
  await expect(panel).toBeVisible();

  // EVERY box in the dialog, not the outer one.
  //
  // The outer box is now `overflow-hidden` with a single `min-h-0` child that
  // is itself the scroller, so it is structurally incapable of reporting
  // horizontal overflow — measuring it would pass for any content at all,
  // including a 976px unbreakable child that scrolls sideways under the
  // reader's thumb. It was only red before the fix because there was no inner
  // scroller then. The symptom is "the dialog scrolls sideways", and after this
  // change the box that would do the scrolling is the body.
  const sideways = await panel.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      // Only boxes that can actually scroll. An SVG `<text>` reports
      // `clientWidth: 0` against a non-zero `scrollWidth` and is not a
      // scrollport at all, so a bare width comparison flags every label in
      // every chart.
      .filter(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && ["auto", "scroll"].includes(getComputedStyle(el).overflowX),
      )
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({
        what: `${el.tagName.toLowerCase()}.${el.className}`,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
      // layerchart's own tooltip context carries a few px inside its own box and
      // is not the dialog scrolling; it is excluded by name, not by slackening
      // the threshold, so anything else still fails.
      .filter((o) => !o.what.includes("lc-tooltip-context")),
  );
  expect(sideways).toEqual([]);
});

test("the title and the close button survive a scroll to the bottom", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openPage(page, "/#/");
  // The grid node is the tall one: three phase blocks plus its counters.
  await page.getByRole("button", { name: /^Grid/ }).click();

  const panel = dialog(page);
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  // A wheel over the dialog, not a scroll of a named element: whichever box
  // owns the scroll, this is what a reader does to reach the bottom.
  await wheelOver(page, panel);
  await expect
    .poll(async () =>
      panel.evaluate((el) =>
        Math.max(...[el, ...el.querySelectorAll("*")].map((n) => n.scrollTop)),
      ),
    )
    .toBeGreaterThan(100);

  // The title rides along at the top of the box, not somewhere above it.
  const title = panel.getByRole("heading").first();
  const titleBox = await title.boundingBox();
  expect(titleBox!.y).toBeGreaterThanOrEqual(before!.y - 1);
  expect(titleBox!.y).toBeLessThan(before!.y + 64);

  // And the X is still there to be tapped.
  await panel.getByRole("button", { name: "Close" }).click({ timeout: 5_000 });
  await expect(panel).toHaveCount(0);
});
