/**
 * Do canvas charts still paint their series in the colour they were given?
 *
 * A canvas mark resolves `var(--…)` through layerchart's one hidden style
 * resolver, which the root layout now owns (`canvas-style-host.svelte`) — it
 * sits OUTSIDE every `Chart.Container`, so it cannot see a chart's own
 * `[data-chart=…] { --color-<key> }` block. Every canvas series is given a
 * GLOBAL theme token instead, and this pins that those resolve: the price
 * curve's bars are filled with `--color-energy-export`, not the black a
 * failed lookup falls back to.
 */

import { expect, test } from "@playwright/test";
import { openPage } from "./support/open-page";

declare global {
  interface Window {
    __canvasFills?: string[];
  }
}

test("the price curve's bars fill with the theme's export colour", async ({ page }) => {
  await page.addInitScript(() => {
    const fills: string[] = [];
    window.__canvasFills = fills;
    const proto = CanvasRenderingContext2D.prototype;
    const fill = proto.fill;
    proto.fill = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      try {
        const panel = this.canvas.closest("section")?.querySelector("h2")?.textContent?.trim();
        if (panel === "Today" && typeof this.fillStyle === "string") fills.push(this.fillStyle);
      } catch {
        // A probe must never be the reason a chart fails to draw.
      }
      return (fill as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.fill;
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await openPage(page, "/#/statistics");
  await page.mouse.wheel(0, 4000);

  // The token, resolved the way the canvas normalises a colour it is handed.
  const expected = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--color-energy-export)";
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = resolved;
    return ctx.fillStyle;
  });
  expect(expected).not.toBe("#000000");

  await expect
    .poll(async () => page.evaluate(() => window.__canvasFills ?? []), { timeout: 20_000 })
    .toContain(expected);
});
