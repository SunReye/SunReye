/**
 * The source switcher: the plant, or one of its devices, chosen once in the
 * header and followed by every read (#202).
 *
 * A browser claim because what is under test is the wiring of a running
 * document: a control in the shell, a store behind it, and the query string of
 * requests other components issue. The vocabulary (`$lib/source.ts`) and the
 * per-frame filtering (`$lib/live/plant.test.ts`) are proven in milliseconds;
 * only whether a click here changes the requests there exists in a browser.
 */

import { expect, type Page, test } from "@playwright/test";
import { SOURCES_TWO } from "./support/api-fixtures";
import { openPage } from "./support/open-page";

const switcher = (page: Page) => page.locator("[data-source-switcher]");

test("a single-device plant offers no choice", async ({ page }) => {
  const opened = await openPage(page, "/#/statistics");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(switcher(page)).toHaveCount(0);
  // Every series read still names its source — the plant, the default.
  await expect.poll(() => opened.backend.requestCount(/source=plant/)).toBeGreaterThan(0);
  expect(opened.backend.requestCount(/source=(?!plant)/)).toBe(0);
});

test("a two-inverter plant shows the switcher, and choosing a device re-scopes the reads", async ({
  page,
}) => {
  const opened = await openPage(page, "/#/statistics", { sources: SOURCES_TWO });
  const group = switcher(page).getByRole("group", { name: "Source" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("radio", { name: "Plant" })).toHaveAttribute("aria-checked", "true");

  await expect.poll(() => opened.backend.requestCount(/source=plant/)).toBeGreaterThan(0);
  opened.backend.resetRequests();

  await group.getByRole("radio", { name: "West roof" }).click();
  await expect(group.getByRole("radio", { name: "West roof" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // The statistics page refetches under the device — and nothing under the plant.
  await expect.poll(() => opened.backend.requestCount(/source=west/)).toBeGreaterThan(0);
  expect(opened.backend.requestCount(/source=plant/)).toBe(0);

  // The choice survives a reload.
  await page.reload();
  await expect(switcher(page).getByRole("radio", { name: "West roof" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(opened.consoleErrors).toEqual([]);
});
