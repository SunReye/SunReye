/**
 * Settings → Devices: deleting a device.
 *
 * There was no way to delete one — only to retire it, and a retired row stays
 * on the roster for good, so a device added by mistake could never leave. The
 * server now deletes a device that never recorded a reading and refuses the
 * rest (`field: "history"`: every reading references its device ON DELETE
 * RESTRICT). What only exists in a browser is the dialog's side of that: the
 * request it sends, and how a refusal turns into the retire offer.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const open = (page: Page) => openPage(page, "/#/settings/devices");
const dialog = (page: Page) => page.getByRole("dialog");

async function openMenu(page: Page, slug: string) {
  await page.locator(`[data-device='${slug}'] [data-row-menu]`).click();
  return page.getByRole("menu");
}

test("a device with no history is deleted after a confirm, and the request names it", async ({
  page,
}) => {
  const opened = await open(page);
  const menu = await openMenu(page, "meter");
  await menu.getByRole("menuitem", { name: "Delete" }).click();

  const panel = dialog(page);
  await expect(panel.getByRole("heading", { name: "Delete Meter?" })).toBeVisible();
  const sent = page.waitForRequest(
    (r) => r.method() === "DELETE" && r.url().includes("/api/devices/"),
  );
  await panel.getByRole("button", { name: "Delete" }).click();
  expect((await sent).url()).toMatch(/\/api\/devices\/2$/);

  await expect(panel).toHaveCount(0);
  await expect(page.getByText("Meter deleted.")).toBeVisible();
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

test("cancelling sends nothing", async ({ page }) => {
  await open(page);
  let deletes = 0;
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/api/devices/")) deletes += 1;
  });
  const menu = await openMenu(page, "meter");
  await menu.getByRole("menuitem", { name: "Delete" }).click();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(deletes).toBe(0);
});

test("a device with history is refused, and the dialog offers retiring it instead", async ({
  page,
}) => {
  const opened = await open(page);
  const menu = await openMenu(page, "evcc-loadpoint-1");
  await menu.getByRole("menuitem", { name: "Delete" }).click();
  const panel = dialog(page);
  await panel.getByRole("button", { name: "Delete" }).click();

  await expect(panel.getByRole("heading", { name: "Carport has recorded history" })).toBeVisible();
  await panel.getByRole("button", { name: "Retire instead" }).click();
  // The retire confirm takes over — the same one the menu's Retire opens.
  await expect(dialog(page).getByRole("heading", { name: "Retire Carport?" })).toBeVisible();
  // The 409 itself is Chromium's line, not the app's; nothing else may appear.
  expect(opened.consoleErrors.filter((e) => !e.includes("status of 409"))).toEqual([]);
});

test("an already-retired device with history is told it stays retired", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Retired (1)" }).click();
  const menu = await openMenu(page, "old-inverter");
  await menu.getByRole("menuitem", { name: "Delete" }).click();
  const panel = dialog(page);
  await panel.getByRole("button", { name: "Delete" }).click();

  await expect(
    panel.getByRole("heading", { name: "Old inverter has recorded history" }),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "Retire instead" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog(page)).toHaveCount(0);
});

test("the polled device's Delete is refused in the menu, with the reason under it", async ({
  page,
}) => {
  await open(page);
  const menu = await openMenu(page, "inverter");
  const entry = menu.getByRole("menuitem", { name: /Delete/ });
  await expect(entry).toHaveAttribute("aria-disabled", "true");
  await expect(entry).toContainText("being polled");
});
