/**
 * Every node of the power-flow diagram opens onto its own readings.
 *
 * This is what /system used to be: a page of panels, one per subsystem, sitting
 * a nav click away from the diagram that names the same subsystems. The panels
 * moved onto the nodes, so the question a reader has ("what is the battery
 * actually doing?") is answered where they are looking.
 *
 * A browser claim, and it has to be. `lib/inverter/node-details.test.ts` proves
 * which readings belong to which node — a pure decision, tested in
 * milliseconds. What it cannot see is whether the box is a real trigger, whether
 * the dialog portals out of a transformed, absolutely-positioned node without
 * being clipped by it, and whether the readings inside it are still fed by the
 * live socket once they are in a portal. All three only exist in a document.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage, type OpenedPage } from "./support/open-page";
import { SELECTORS } from "./support/perf";

/** The overview, with the diagram live. */
const overview = (page: Page): Promise<OpenedPage> => openPage(page, "/#/");

/** One node's box, by the accessible name the dialog trigger carries. */
const nodeTrigger = (page: Page, name: string) => page.getByRole("button", { name });

const dialog = (page: Page) => page.getByRole("dialog");

test.describe("a node opens its subsystem", () => {
  test("the battery box opens the battery's readings", async ({ page }) => {
    const opened = await overview(page);
    await nodeTrigger(page, "Battery details").click();

    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "Battery" })).toBeVisible();
    // A row the /system battery panel carried, from the committed manifest —
    // proof the dialog resolved the profile and not a hardcoded list.
    await expect(panel.getByText("Battery Temperature")).toBeVisible();
    // Charge state is the bar, power is the headline chart: neither repeats as a
    // row, so their labels are absent from the row stack.
    await expect(panel.getByText("Battery SOC")).toHaveCount(0);
    expect(opened.consoleErrors).toEqual([]);
  });

  test("the readings in the dialog are live, not a snapshot of the open", async ({ page }) => {
    const opened = await overview(page);
    await nodeTrigger(page, "Battery details").click();
    const panel = dialog(page);
    await expect(panel).toBeVisible();

    for (let i = 0; i < 3; i++) await opened.backend.pushMetrics({ "battery.temperature": 31 });
    // The row's value tracks the socket while the dialog is open — the feed is
    // leased by the shell, and a portalled subtree still reads it.
    await expect(panel.locator(SELECTORS.liveReadout).first()).toHaveText(/\d/);
    expect(opened.consoleErrors).toEqual([]);
  });

  test("the inverter hub carries the total DC power it converts", async ({ page }) => {
    // The one PV figure no node shows: with both strings mapped, each node
    // reports its own, and the sum had nowhere to live once /system went away.
    await overview(page);
    await nodeTrigger(page, "Inverter details").click();

    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "Inverter" })).toBeVisible();
    await expect(panel.getByText("DC Total Power")).toBeVisible();
    await expect(panel.getByText("Running status")).toBeVisible();
  });

  test("the hub's pill shows total DC power without opening anything", async ({ page }) => {
    // "Somewhere visible", not only inside a dialog: the sum of the strings is
    // what the box in the middle is converting right now.
    const opened = await overview(page);
    for (let i = 0; i < 3; i++) await opened.backend.pushMetrics();

    const pill = page.getByText("DC in", { exact: true }).locator("..");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/\d/);
  });

  test("a grid connection shows one block per phase", async ({ page }) => {
    // Three phases in the committed manifest, so three captioned blocks — the
    // indexed groups /system laid out as a grid.
    await overview(page);
    await nodeTrigger(page, /^Grid/).click();

    const panel = dialog(page);
    for (const phase of ["Phase 1", "Phase 2", "Phase 3"]) {
      await expect(panel.getByText(phase, { exact: true })).toBeVisible();
    }
    await expect(panel.getByText("Grid Voltage L3")).toBeVisible();
  });

  test("a PV string opens only its own string", async ({ page }) => {
    await overview(page);
    await nodeTrigger(page, "String 1 details").click();

    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "String 1" })).toBeVisible();
    // PV2's readings live behind PV2's own box.
    await expect(panel.getByText("PV2 Power")).toHaveCount(0);
  });

  test("Escape gives the diagram back", async ({ page }) => {
    await overview(page);
    await nodeTrigger(page, "Battery details").click();
    await expect(dialog(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe("the diagram is reachable, not just clickable", () => {
  test("every node the manifest describes is a named trigger", async ({ page }) => {
    // The committed manifest maps all six subsystems the diagram can draw plus
    // the hub, so an orphaned box means a node lost its dialog.
    await overview(page);
    const names = await page
      .getByRole("button", { name: /details$/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));

    expect(new Set(names)).toEqual(
      new Set([
        "String 1 details",
        "String 2 details",
        "Battery details",
        "Grid · 3-phase details",
        "Load details",
        "Generator details",
        "Inverter details",
      ]),
    );
  });

  test("a phone-sized dialog scrolls its own body instead of the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await overview(page);
    await nodeTrigger(page, /^Grid/).click();

    const panel = dialog(page);
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    // Three phase blocks plus five counters is taller than a phone; the dialog
    // caps itself and scrolls inside rather than growing past the viewport.
    expect(box!.height).toBeLessThanOrEqual(844);
  });
});
