/**
 * JOURNEY: a signed-in user opens the dashboard and watches it live.
 *
 * Walked the way a person does it — load, read the diagram, see a number move,
 * open History from the navigation and come back — with a user-visible
 * assertion at every step. The single-claim specs below each of these steps
 * (`shell-lease-loop`, `page-smoke`, `source-switcher`) prove their mechanism in
 * isolation; what only this one proves is that the steps compose: the socket
 * the overview leased is still the one feeding it after a round trip through
 * another route.
 *
 * The feed is manual (`feedIntervalMs: 0`), so a reading that changes changed
 * because of the frame this spec pushed, not because a timer happened to fire.
 */

import { expect, type Page, test } from "@playwright/test";
import { mockBackend } from "./support/api-mock";
import { POWER_FLOW_READOUTS, powerFlowReadouts } from "./support/open-page";

/** The shell's `<h1>` — fed by each route's `setPageHeader`. */
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

/** The power-flow diagram's own section, found by its (screen-reader) heading. */
const powerFlow = (page: Page) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Power flow", exact: true }) });

/** Open the navigation (an overlay on every viewport) and follow one entry. */
async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await page.getByRole("link", { name: label, exact: true }).click();
}

test.describe("journey: live dashboard", () => {
  test("first load boots the shell, goes live, moves a reading, and survives a trip to History", async ({
    page,
  }) => {
    const backend = await mockBackend(page, { feedIntervalMs: 0 });

    // ── 1. First load: the shell boots onto the overview ────────────────────
    await page.goto("/#/");
    await expect(heading(page)).toHaveText("Overview");

    // ── 2. The live socket connects and subscribes ──────────────────────────
    await backend.waitForLive();
    expect(backend.socketOpens).toBe(1);

    // ── 3. The diagram shows numbers, not the em dash of an absent value ────
    const readouts = powerFlowReadouts(page);
    await expect(readouts).toHaveCount(POWER_FLOW_READOUTS);
    await expect
      .poll(async () => (await readouts.allTextContents()).filter((t) => !/\d/.test(t)))
      .toEqual([]);

    // ── 4. A pushed live frame changes what the user sees ───────────────────
    // A charge level no generated sample lands on (valueFor rounds to one
    // decimal; the SoC readout is whole percent), so "77%" can only be this frame.
    await expect(powerFlow(page).getByText("77%", { exact: true })).toHaveCount(0);
    await backend.pushMetrics({ "battery.soc": 77 });
    await expect(powerFlow(page).getByText("77%", { exact: true })).toBeVisible();
    await backend.pushMetrics({ "battery.soc": 31 });
    await expect(powerFlow(page).getByText("31%", { exact: true })).toBeVisible();
    await expect(powerFlow(page).getByText("77%", { exact: true })).toHaveCount(0);

    // ── 5. Navigate to History through the nav ──────────────────────────────
    await navigateTo(page, "History");
    await expect(page).toHaveURL(/#\/history$/);
    await expect(heading(page)).toHaveText("History");
    await expect(page.getByRole("group", { name: "Select time span" })).toBeVisible();

    // ── 6. …and back to the overview, still live on the same socket ─────────
    await navigateTo(page, "Overview");
    await expect(page).toHaveURL(/#\/$/);
    await expect(heading(page)).toHaveText("Overview");
    await expect(readouts).toHaveCount(POWER_FLOW_READOUTS);
    await backend.pushMetrics({ "battery.soc": 64 });
    await expect(powerFlow(page).getByText("64%", { exact: true })).toBeVisible();

    // One connection for the whole session: the route changes re-used it.
    expect(backend.socketOpens).toBe(1);
    expect(backend.unhandled).toEqual([]);
  });
});
