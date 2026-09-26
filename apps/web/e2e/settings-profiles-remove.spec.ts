/**
 * Settings → Profiles: removing a downloaded profile asks first.
 *
 * The trash icon used to send the DELETE on its first tap — on a phone, where
 * that icon sits under a scrolling thumb, that is an accidental uninstall away.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const deletes = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/api/profiles/")) seen.push(r.url());
  });
  return seen;
};

test("the trash icon opens a confirm, and only the confirm deletes", async ({ page }) => {
  const opened = await openPage(page, "/#/settings/profiles");
  const seen = deletes(page);
  await page.getByRole("button", { name: "Delete profile Sungrow SH10RT" }).click();

  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: "Remove Sungrow SH10RT?" })).toBeVisible();
  expect(seen).toEqual([]);

  await panel.getByRole("button", { name: "Remove" }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0]).toContain("/api/profiles/");
  expect(opened.consoleErrors).toEqual([]);
});

test("cancelling the confirm deletes nothing", async ({ page }) => {
  await openPage(page, "/#/settings/profiles");
  const seen = deletes(page);
  await page.getByRole("button", { name: "Delete profile Sungrow SH10RT" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(seen).toEqual([]);
});
