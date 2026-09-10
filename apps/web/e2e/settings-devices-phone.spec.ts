/**
 * Settings → Devices on a 400px phone.
 *
 * A browser claim because every one of these is a resolved layout: whether the
 * document scrolls sideways, whether the tab strip clips its last tab or
 * scrolls to it, whether the device row stacks, and whether a separator ends up
 * dangling at the end of a wrapped line. None of that is a value a unit test
 * can hold — and the tab strip is shared by every settings panel, so it is
 * measured here once for all of them.
 *
 * Reported at ~400px (#214): meta lines breaking mid-unit ("every 2 / s"),
 * `·` separators dangling at line ends because they were interleaved text
 * nodes, a header row fighting for width, and a tab strip clipped on the right.
 */

import { expect, type Locator, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

/** Narrower than the 412px the density work is measured at — the reported width. */
const PHONE = { width: 400, height: 844 };

/** The settings tab strip: the phone-width nav, shared by every panel. */
const tabStrip = (page: Page): Locator => page.locator("nav[aria-label='Settings']").last();

/**
 * Open /settings/devices at phone width, laid out.
 *
 * Visible is NOT laid out (see `period-navigator.spec.ts`): Vite dev serves the
 * stylesheet as its own module, and an unstyled document is all `display:
 * block` — which is precisely the stacked, overflowing shape some of these
 * cases assert must NOT happen elsewhere. The device row is `flex` at every
 * width (only its direction is responsive), so waiting for that pins the
 * stylesheet without pinning a breakpoint.
 */
async function openDevices(page: Page) {
  await page.setViewportSize(PHONE);
  const opened = await openPage(page, "/#/settings/devices");
  const row = page.locator("[data-device='inverter']");
  await expect(row).toBeVisible();
  await expect(row).toHaveCSS("display", "flex");
  return opened;
}

test("the page does not scroll sideways at 400px", async ({ page }) => {
  await openDevices(page);
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  // 1px of rounding, not a column of content.
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
});

test("the settings tab strip scrolls to its last tab instead of clipping it", async ({ page }) => {
  await openDevices(page);
  const strip = tabStrip(page);

  // The strip itself is the ONE thing allowed to be wider than the screen —
  // fifteen panels do not fit — and it may only be wider INSIDE its own scroll
  // container. The document case above is what says it does not leak out.
  const scroll = await strip.evaluate((el) => ({
    scrollable: el.scrollWidth > el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(scroll.scrollable).toBe(true);
  expect(scroll.overflowX).toBe("auto");

  // Clipped means the last tab cannot be reached. Scroll to the end and it is
  // inside the strip's own box.
  const last = strip.getByRole("link").last();
  await strip.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  const [box, stripBox] = await Promise.all([last.boundingBox(), strip.boundingBox()]);
  expect(box).not.toBeNull();
  expect(stripBox).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(stripBox!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(stripBox!.x + stripBox!.width + 1);
});

test("a device row stacks its identity above its controls", async ({ page }) => {
  await openDevices(page);
  const boxes = await page
    .locator("[data-device='inverter'] > *")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(boxes.length).toBe(2);
  // Two rows, not two columns squeezed side by side.
  expect(boxes[1]).toBeGreaterThan(boxes[0]);
});

test("a meta line never ends with a dangling separator", async ({ page }) => {
  await openDevices(page);
  const meta = page.locator("[data-device='inverter'] [data-slot='device-meta']");
  await expect(meta).toBeVisible();

  // The separators are CSS, so they are not in the text at all — which is what
  // makes a wrap impossible to end on one. An interleaved `<span>·</span>` is a
  // flex item like any other and lands wherever the wrap puts it ("Unit 0 ·").
  const text = await meta.evaluate((el) => el.textContent ?? "");
  expect(text).not.toContain("·");

  // …and they are really drawn: every item but the first leads with one.
  const drawn = await meta.evaluate((el) =>
    [...el.children].map((child) => getComputedStyle(child, "::before").content),
  );
  expect(drawn.length).toBeGreaterThan(1);
  expect(drawn[0]).toBe("none");
  for (const content of drawn.slice(1)) expect(content).toContain("·");
});

test("a gateway's cadence never breaks between the number and its unit", async ({ page }) => {
  await openDevices(page);
  // A plain space put "every 2" on one line and "s" on the next.
  const caption = await page
    .getByText(/Modbus TCP/)
    .first()
    .evaluate((el) => el.textContent ?? "");
  expect(caption).toContain("every 1 s");
  expect(caption).not.toContain("every 1 s");
});
