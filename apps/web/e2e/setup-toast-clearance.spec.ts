/**
 * A toast never covers the setup wizard's pinned actions.
 *
 * Saving the connection raises a success toast in the same bottom band the
 * pinned footer holds, and the toast won the hit-test: Back could not be
 * pressed until it timed out. Geometry and hit-testing only exist in a laid-out
 * document, so this is a browser claim, at both a phone and a desktop width
 * (sonner lays toasts out differently below 600px).
 */

import { expect, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const WIDTHS = [
  { name: "phone", size: { width: 400, height: 844 } },
  { name: "desktop", size: { width: 1280, height: 800 } },
];

for (const { name, size } of WIDTHS) {
  test(`a toast raised on setup clears the pinned footer (${name})`, async ({ page }) => {
    await page.setViewportSize(size);
    await openPage(page, "/#/setup", { live: false, needsProfile: true });

    const footer = page.locator("[data-setup-footer]");
    await page.getByRole("button", { name: "Select", exact: true }).first().click();
    await footer.getByRole("button", { name: "Continue" }).click();
    // Continue on the connection step IS the save, and the save toasts.
    await footer.getByRole("button", { name: "Continue" }).click();

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible();
    // Sonner slides the toast in; measure where it settles, not mid-flight.
    await expect(toast).toHaveAttribute("data-mounted", "true");
    await page.waitForTimeout(500);

    const t = await toast.boundingBox();
    const f = await footer.boundingBox();
    if (!t || !f) throw new Error("toast or footer has no box");
    expect(t.y + t.height, "toast bottom sits above the footer top").toBeLessThanOrEqual(f.y + 0.5);

    // Back is pressable while the toast is still up — no waiting it out.
    await expect(toast).toBeVisible();
    await footer.getByRole("button", { name: "Back" }).click({ timeout: 2000 });
    await expect(page.locator("ol [aria-current='step']")).toContainText("Connection");
  });
}
