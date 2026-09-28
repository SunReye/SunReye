/**
 * The first-run journey on a phone: `/onboarding` then `/setup`, one rail.
 *
 * Browser claims, because each is a resolved document: whether the rail marks
 * the right step for a screen reader, whether the step's primary action is on
 * screen without scrolling past a profile list (the sticky footer), and whether
 * the connection step still offers a second Save beside Continue.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const PHONE = { width: 400, height: 844 };

const currentStep = (page: Page) => page.locator("ol [aria-current='step']");

test("onboarding is step one of the same four-step rail", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openPage(page, "/#/onboarding", { live: false, needsSetup: true, role: null });
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(4);
  await expect(currentStep(page)).toContainText("Account");
});

test("setup walks profile → connection → activate with its actions pinned to the screen", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const opened = await openPage(page, "/#/setup", { live: false, needsProfile: true });
  await expect(currentStep(page)).toContainText("Profile");

  // The footer is on screen before any scroll, and Continue waits for a choice.
  const footer = page.locator("[data-setup-footer]");
  const next = footer.getByRole("button", { name: "Continue" });
  await expect(next).toBeInViewport();
  await expect(next).toBeDisabled();

  await page.getByRole("button", { name: "Select", exact: true }).first().click();
  await expect(next).toBeEnabled();
  await next.click();

  await expect(currentStep(page)).toContainText("Connection");
  // Continue IS the save here; a second Save beside it asked for two presses.
  await expect(page.getByRole("button", { name: "Test connection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await footer.getByRole("button", { name: "Continue" }).click();

  await expect(currentStep(page)).toContainText("Activate");
  await expect(footer.getByRole("button", { name: "Activate profile" })).toBeInViewport();
  await footer.getByRole("button", { name: "Back" }).click();
  await expect(currentStep(page)).toContainText("Connection");
  expect(opened.consoleErrors).toEqual([]);
});

test("nothing on the setup steps scrolls sideways at 400px", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openPage(page, "/#/setup", { live: false, needsProfile: true });
  await expect(page.locator("[data-setup-footer]")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
