/**
 * The shell's sticky chrome on a phone: what sticks, where it stops, and what
 * is allowed to paint over the app header.
 *
 * Every claim here is a resolved stacking order or a resolved sticky offset,
 * and neither is readable from the source.
 *
 *  - `z-20` beats `z-10` only when the two elements land in the SAME stacking
 *    context. The header is a sticky child of `Sidebar.Inset`; the settings
 *    save bar is a sticky child of `main`, a sibling subtree — so those two
 *    numbers really do compete, and the bar really did drag its backdrop-blur
 *    across the header on the way past. Put a `transform`, a `filter` or an
 *    `isolation` anywhere on either chain and the same class strings resolve
 *    the other way round.
 *  - A `position: sticky` element resolves against its nearest SCROLL
 *    CONTAINER. `main` is styled as one (`overflow-y-auto`) but the sidebar
 *    wrapper above it is `min-h-svh`, never `h-svh`, so `main` is always
 *    exactly as tall as its content and never scrolls — the DOCUMENT does.
 *    Sticky chrome inside it therefore never stuck at all, whatever `top-0`
 *    said, and the offsets that do work are measured from the viewport, where
 *    the header already owns the first `--app-header-h`.
 *
 * Reported on a phone: the settings tab strip scrolls away (so switching panel
 * means scrolling a long form back to the top), and the save bar, its
 * translucency and a chart's corner ⤢ all travel OVER the header.
 */

import { expect, type Locator, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";
import { openHistory, periodNavigator } from "./support/history";
import { SELECTORS } from "./support/perf";

/** The narrow phone the report came from. */
const PHONE = { width: 360, height: 780 };

/** Wide enough for the `md:` settings grid — the rail, not the tab strip. */
const DESKTOP = { width: 1280, height: 900 };

/** 1px of sub-pixel rounding, not a row of content. */
const SLOP = 1;

/** The app shell's header — the one `<header>` in `(app)/+layout.svelte`. */
const appHeader = (page: Page): Locator => page.locator("header").first();

/** The phone-width settings tab strip (the desktop rail is the other one). */
const tabStrip = (page: Page): Locator => page.locator("nav[aria-label='Settings']").last();

/** The shared settings save/action row. */
const actionBar = (page: Page): Locator => page.locator("[data-slot=settings-action-bar]").first();

/**
 * Open a route at phone width, laid out.
 *
 * Visible is not laid out: Vite dev serves the stylesheet as its own module and
 * an unstyled document is all `display: block` — a shape in which nothing is
 * sticky and nothing overlaps, so every case below would pass for the wrong
 * reason. A sticky header is the stylesheet's own fingerprint here.
 */
async function openAtPhone(page: Page, url: string) {
  await page.setViewportSize(PHONE);
  const opened = await openPage(page, url);
  await expect(appHeader(page)).toHaveCSS("position", "sticky");
  return opened;
}

/** Scroll the page and let the compositor resolve the sticky offsets. */
async function scrollPage(page: Page, top: number): Promise<number> {
  const at = await page.evaluate((y) => {
    document.scrollingElement!.scrollTop = y;
    return document.scrollingElement!.scrollTop;
  }, top);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  return at;
}

/** A laid-out box, asserted to exist so the assertion below is about numbers. */
async function box(target: Locator) {
  const rect = await target.boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}

/**
 * Which elements own the header's own pixels right now.
 *
 * `elementFromPoint` reports the order the compositor resolved, not the one the
 * classes declare — the same question a reader answers by looking at the
 * screen. Sampled across the width because an offender only covers the part of
 * the row its own box spans.
 */
async function trespassersOverHeader(page: Page): Promise<string[]> {
  const rect = await box(appHeader(page));
  return page.evaluate((r) => {
    const found = new Set<string>();
    for (let i = 1; i < 10; i++) {
      const hit = document.elementFromPoint(r.x + (r.width * i) / 10, r.y + r.height / 2);
      if (hit?.closest("header")) continue;
      found.add(hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : "nothing");
    }
    return [...found];
  }, rect);
}

/**
 * Sweep the page past the header and collect everything that painted over it.
 *
 * A sweep rather than one scroll position, because the offenders here are NOT
 * sticky: the save bar and a chart's corner control cross the header band on
 * their way up and are gone again a few hundred pixels later. One sample of a
 * moving object proves nothing.
 */
async function sweepForTrespassers(page: Page, through: number): Promise<string[]> {
  const found = new Set<string>();
  for (let top = 0; top <= through; top += 20) {
    await scrollPage(page, top);
    for (const who of await trespassersOverHeader(page)) found.add(who);
  }
  return [...found];
}

test("the settings tab strip stays under the header while the panel scrolls", async ({ page }) => {
  await openAtPhone(page, "/#/settings/display");

  const header = await box(appHeader(page));
  const at = await scrollPage(page, 600);
  // A page that did not scroll proves nothing about a strip that scrolled away.
  expect(at).toBeGreaterThan(200);

  const strip = await box(tabStrip(page));
  // Under the header, touching it — not gone, and not on top of it.
  expect(strip.y).toBeGreaterThanOrEqual(header.y + header.height - SLOP);
  expect(strip.y).toBeLessThanOrEqual(header.y + header.height + SLOP);
});

test("the save bar sticks below the tab strip, not on top of it", async ({ page }) => {
  await openAtPhone(page, "/#/settings/display");
  const at = await scrollPage(page, 600);
  expect(at).toBeGreaterThan(200);

  const header = await box(appHeader(page));
  const strip = await box(tabStrip(page));
  const bar = await box(actionBar(page));
  // The full vertical stack on a 360px phone: header, tabs, save bar, content —
  // and all three still ON that phone, which is the half that says the bar is
  // stuck rather than merely somewhere below the strip on its way off the top.
  expect(strip.y).toBeGreaterThanOrEqual(header.y + header.height - SLOP);
  expect(bar.y).toBeGreaterThanOrEqual(strip.y + strip.height - SLOP);
  expect(bar.y + bar.height).toBeLessThan(PHONE.height);
});

test("nothing in a settings panel paints over the app header", async ({ page }) => {
  await openAtPhone(page, "/#/settings/display");
  expect(await sweepForTrespassers(page, 600)).toEqual([]);
});

test("a chart's corner control never paints over the app header", async ({ page }) => {
  await openAtPhone(page, "/#/statistics");
  // The control exists on this page at all — otherwise the sweep below is a
  // green assertion about a page with nothing to assert.
  await expect(
    page
      .locator("button")
      .filter({ hasText: /full screen/i })
      .first(),
  ).toBeAttached();

  expect(await sweepForTrespassers(page, 1200)).toEqual([]);
});

/**
 * The sensor catalog's group header sticks to ITS OWN box, not the shell.
 *
 * Regression cover for a removal, which is why it exists at all. The sticky was
 * taken off this row on the reasoning that its scroll container was the shell's
 * `main`, which never scrolls — true of the shell, false of this row: the
 * catalog renders inside `max-h-[60svh] overflow-y-auto` (sensors-form.svelte),
 * a real scroll container, so `top-0` here always resolved against the box and
 * always stuck. Nothing caught it, because nothing tested it.
 *
 * Deliberately measured against the BOX, never against `--sticky-top`: a row
 * inside a scrolling card answers to a different scrollport than the page
 * chrome does, and conflating the two is the mistake this case is here to stop.
 */
test("a sensor group header stays pinned to its own scrolling box", async ({ page }) => {
  await openAtPhone(page, "/#/settings/sensors");

  const catalog = page.locator("[data-slot=sensor-catalog]").first();
  await expect(catalog).toBeVisible();
  // A box that cannot scroll makes every assertion below vacuously true.
  const scrollable = await catalog.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(scrollable).toBeGreaterThan(80);

  const header = catalog.locator("[data-slot=sensor-group-header]").first();
  await expect(header).toHaveCSS("position", "sticky");

  const before = await box(header);
  const moved = await catalog.evaluate((el) => {
    el.scrollTop = 200;
    return el.scrollTop;
  });
  expect(moved).toBeGreaterThan(80);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

  const catalogBox = await box(catalog);
  const after = await box(header);
  // Still on screen, still at the top edge of its own box — not scrolled away
  // with the rows, and not dragged up to the shell's header.
  expect(after.y).toBeGreaterThanOrEqual(catalogBox.y - SLOP);
  expect(after.y).toBeLessThanOrEqual(catalogBox.y + SLOP);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(SLOP);
});

/**
 * The same offset contract on the `md:` grid, where the tab strip does not
 * render at all.
 *
 * The phone cases above cannot see this: the strip's measured height feeds
 * `--sticky-top`, and on desktop that measurement must come back 0 so the save
 * bar parks directly under the header instead of a phone-strip's height below
 * it. A wrong desktop offset passes every other case in this file.
 */
test("on desktop the save bar sticks straight under the header, with no strip in the sum", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await openPage(page, "/#/settings/display");
  await expect(appHeader(page)).toHaveCSS("position", "sticky");

  // The phone strip is `md:hidden`, so it contributes nothing here.
  await expect(tabStrip(page)).toBeHidden();

  const at = await scrollPage(page, 400);
  expect(at).toBeGreaterThan(100);

  const header = await box(appHeader(page));
  const bar = await box(actionBar(page));
  expect(bar.y).toBeGreaterThanOrEqual(header.y + header.height - SLOP);
  expect(bar.y).toBeLessThanOrEqual(header.y + header.height + SLOP);
});

/**
 * The zoom RESET control, reported travelling over the header like the ⤢ did.
 *
 * It needed its own case because it is conditional: `zoom-controls.svelte`
 * draws it only once the domain has actually moved, so the sweep over
 * /statistics — which asserts the ⤢ exists and nothing more — never had this
 * button on the page at all and would have stayed green with it at any
 * z-index. A pinch is the only thing that makes it appear.
 */
test("a chart's zoom reset never paints over the app header", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openHistory(page);
  await periodNavigator(page).back.click();

  const card = page.locator(SELECTORS.metricCard).first();
  const chart = card.locator(SELECTORS.chart).first();
  await expect(chart).toBeVisible();
  await expect(chart.locator(".lc-transform-context")).toBeAttached();
  await chart.scrollIntoViewIfNeeded();
  const plot = await box(chart);

  const reset = card.getByRole("button", { name: "Reset zoom" });
  await expect(reset).toHaveCount(0);

  // Two fingers, through the browser's own input pipeline — `page.touchscreen`
  // only taps, so a pinch is not reachable through it.
  const cdp = await page.context().newCDPSession(page);
  const y = plot.y + plot.height / 2;
  const centre = plot.x + plot.width / 2;
  const at = (spread: number) => [
    { id: 1, x: centre - spread, y },
    { id: 2, x: centre + spread, y },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(30) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(30 + i * 10) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  // The control is on the page now — otherwise the sweep proves nothing.
  await expect(reset).toBeVisible();

  expect(await sweepForTrespassers(page, 1200)).toEqual([]);
});
