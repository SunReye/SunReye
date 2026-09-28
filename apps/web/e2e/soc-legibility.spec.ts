/**
 * The state-of-charge percentage has to be readable.
 *
 * On the power-flow diagram the battery (and, when EVCC reports one vehicle,
 * the EV charger) is the one node people read as a NUMBER rather than as a
 * shape: "how full is it" is the question the hero answers at a glance from
 * across a room. It was rendered as a 0.62rem (9.9 px) badge hanging off the
 * bottom edge of the node box, tinted with the SoC ramp — `--sign-warn` is
 * `#f59e0b`, which against the light theme's white background is a 2.2:1
 * contrast ratio. Small AND low contrast: two complaints, two defects.
 *
 * A browser claim because both are questions about a rendered document:
 * `getComputedStyle` after the cascade has run, and geometry after layout. A
 * source-text test could only assert that some class name appears in a file,
 * which is exactly the thing `apps/web/TESTING.md` forbids standing in for a
 * fix's own text.
 *
 * Three claims, none of them "a font-size literal appears somewhere":
 *   1. **Legible** — at or above the repo's mobile floor, and by a margin:
 *      16 px on the node, 14 px on the EV tile.
 *   2. **Dominant** — on the diagram the percentage is strictly the largest
 *      live readout there is. That is what "the number people read at a
 *      glance" means, and it is a ratio, so it survives a type-scale change.
 *   3. **Contained and contrasted** — the glyphs sit inside the node box at
 *      every supported width (no clipping, no wrap, nothing pushed out), and
 *      the ink reaches WCAG AA (4.5:1) against what it is actually painted on.
 */

import { expect, type Locator, type Page, test } from "@playwright/test";
import { SELECTORS } from "./support/perf";
import { evChargerCard, openPage } from "./support/open-page";

/** Every state-of-charge percentage the app renders, node and tile alike. */
const SOC = ".soc-readout";

/** Phones the dashboard is opened on, plus the wall tablet it lives on. */
const WIDTHS = [
  { label: "360px phone", width: 360, height: 800 },
  { label: "412px phone", width: 412, height: 961 },
  { label: "820px tablet", width: 820, height: 1180 },
  { label: "1600px wall", width: 1600, height: 900 },
] as const;

/**
 * The contrast ratio of an element's text against what it is painted on, and
 * its rendered font size in CSS pixels.
 *
 * The background is resolved by walking up until an opaque layer is found
 * rather than read off the element itself: the percentage has no background of
 * its own, and `rgba(0,0,0,0)` is what every un-styled span reports. Colours go
 * through a canvas so `oklab()`/`color-mix()` — what this theme's computed
 * values actually are — come back as channels instead of as a string nobody
 * can average.
 */
async function inkOf(target: Locator): Promise<{ fontSize: number; contrast: number }> {
  return target.evaluate((el: Element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const channels = (color: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    // WCAG relative luminance.
    const luminance = ([r, g, b]: [number, number, number, number]): number => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const style = getComputedStyle(el);
    const fg = channels(style.color);
    let backdrop: [number, number, number, number] = [255, 255, 255, 1];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const layer = channels(getComputedStyle(node).backgroundColor);
      // Only an effectively opaque layer settles it; a 10 % tint does not.
      if (layer[3] > 0.9) {
        backdrop = layer;
        break;
      }
    }
    const a = luminance(fg);
    const b = luminance(backdrop);
    const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { fontSize: Number.parseFloat(style.fontSize), contrast };
  });
}

/** The power-flow section, by its own (screen-reader) heading. */
function diagram(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Power flow", exact: true }) });
}

test("the state of charge is the diagram's biggest, highest-contrast figure", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 961 });
  const opened = await openPage(page, "/#/");
  const socs = diagram(page).locator(SOC);
  await expect(socs.first()).toBeVisible();

  // Every percentage on the diagram, not just the battery: the EV charger node
  // rings a vehicle SoC from the same component and had the same badge.
  const count = await socs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const { fontSize, contrast } = await inkOf(socs.nth(i));
    expect(fontSize, `soc #${i} font size`).toBeGreaterThanOrEqual(16);
    expect(contrast, `soc #${i} contrast ratio`).toBeGreaterThanOrEqual(4.5);
  }

  // The readout's own children too, not just the element the class sits on.
  // The `%` is a nested span sized in `em`, so a gauge whose number clears 16px
  // can still draw its unit at 9.9px — under the 12px phone floor the layout
  // system states, inside the very element this spec exists to keep legible.
  // Measuring only the parent is how that shipped.
  const glyphs = await socs.evaluateAll((els) =>
    els.flatMap((el, i) =>
      [...el.querySelectorAll("*")].map((child) => ({
        soc: i,
        text: child.textContent ?? "",
        px: Number.parseFloat(getComputedStyle(child).fontSize),
      })),
    ),
  );
  const tooSmall = glyphs.filter((g) => g.px < 12);
  expect(tooSmall, "sub-floor glyphs inside a SoC readout").toEqual([]);

  // Dominant: strictly larger than every other live readout the diagram draws
  // (node power values, the hub's DC-in and efficiency). A ratio, so a change
  // to the whole type scale keeps this green and a demotion turns it red.
  const sizes = await diagram(page)
    .locator(SELECTORS.liveReadout)
    .evaluateAll((els) =>
      els.map((el) => ({
        soc: el.classList.contains("soc-readout"),
        px: Number.parseFloat(getComputedStyle(el).fontSize),
      })),
    );
  const others = sizes.filter((s) => !s.soc).map((s) => s.px);
  expect(others.length).toBeGreaterThan(0);
  const smallestSoc = Math.min(...sizes.filter((s) => s.soc).map((s) => s.px));
  expect(smallestSoc).toBeGreaterThan(Math.max(...others));

  expect(opened.consoleErrors).toEqual([]);
});

for (const { label, width, height } of WIDTHS) {
  test(`the state of charge fits inside its node box at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const opened = await openPage(page, "/#/");
    const socs = diagram(page).locator(SOC);
    await expect(socs.first()).toBeVisible();

    const count = await socs.count();
    for (let i = 0; i < count; i++) {
      const fit = await socs.nth(i).evaluate((el: Element) => {
        const box = el.closest(".power-node-box");
        if (!box) throw new Error("the soc percentage is not inside a power-flow node box");
        const a = el.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        return {
          overflowX: Math.max(0, b.left - a.left) + Math.max(0, a.right - b.right),
          overflowY: Math.max(0, b.top - a.top) + Math.max(0, a.bottom - b.bottom),
          // One line: a wrapped "100%" is a clipped "100%" in a 56 px box.
          lines: Math.round(a.height / Number.parseFloat(getComputedStyle(el).lineHeight || "1")),
        };
      });
      // Sub-pixel slack only — a device-pixel-ratio rounding, not a glyph.
      expect(fit.overflowX, `soc #${i} horizontal overflow`).toBeLessThanOrEqual(0.5);
      expect(fit.overflowY, `soc #${i} vertical overflow`).toBeLessThanOrEqual(0.5);
      expect(fit.lines, `soc #${i} line count`).toBeLessThanOrEqual(1);
    }
    expect(opened.consoleErrors).toEqual([]);
  });
}

test("the EV tile's state of charge is legible on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 961 });
  await openPage(page, "/#/");
  const soc = evChargerCard(page).locator(SOC);
  await expect(soc).toBeVisible();
  const { fontSize, contrast } = await inkOf(soc);
  expect(fontSize, "ev tile soc font size").toBeGreaterThanOrEqual(14);
  expect(contrast, "ev tile soc contrast ratio").toBeGreaterThanOrEqual(4.5);
});
