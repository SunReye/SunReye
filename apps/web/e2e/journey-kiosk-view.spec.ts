/**
 * JOURNEY: the admin switches the kiosk view on, and a fresh browser reads the
 * dashboard without signing in.
 *
 * The visitor's browser shares nothing with the admin's: a new context, no
 * cookie. With the kiosk view on it gets the overview live and read-only (no
 * settings in the navigation, no write sent, a settings address bounces back);
 * with it off the same visitor lands on the login page.
 */

import { type Browser, expect, type Page, test } from "@playwright/test";
import { type MockBackend, mockBackend } from "./support/api-mock";

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

async function freshVisitor(
  browser: Browser,
  kiosk: boolean,
): Promise<{ page: Page; backend: MockBackend; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const backend = await mockBackend(page, { role: null, kiosk, feedIntervalMs: 0 });
  return { page, backend, close: () => context.close() };
}

test.describe("journey: kiosk view", () => {
  test("an admin switches it on and a fresh browser watches the dashboard read-only", async ({
    page,
    browser,
  }) => {
    // ── 1. The admin switches the kiosk view on in Settings → Access ────────
    const admin = await mockBackend(page, { kiosk: false });
    await page.goto("/#/settings/access");
    const toggle = page.getByRole("switch", { name: "Kiosk view" });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    const switched = admin.writes.filter((w) => w.path === "/api/settings/kiosk");
    expect(switched).toEqual([
      { method: "PUT", path: "/api/settings/kiosk", body: { enabled: true } },
    ]);

    // ── 2. A fresh browser opens the dashboard without signing in ───────────
    const visitor = await freshVisitor(browser, true);
    await visitor.page.goto("/#/");
    await expect(heading(visitor.page)).toHaveText("Overview");
    await visitor.backend.waitForLive();
    await visitor.backend.pushMetrics({ "battery.soc": 77 });
    await expect(visitor.page.getByText("77%", { exact: true }).first()).toBeVisible();

    // ── 3. Read-only: no settings in the navigation, the way in is "Log in" ─
    await visitor.page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
    await expect(visitor.page.getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(visitor.page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
    await expect(visitor.page.getByRole("button", { name: "Sign out" })).toHaveCount(0);

    // ── 4. A settings address bounces back to the overview ──────────────────
    await visitor.page.goto("/#/settings/access");
    await expect(visitor.page).toHaveURL(/#\/$/);
    await expect(heading(visitor.page)).toHaveText("Overview");
    expect(visitor.backend.writes).toEqual([]);
    expect(visitor.backend.unhandled).toEqual([]);
    await visitor.close();
    expect(admin.unhandled).toEqual([]);
  });

  test("with it off a fresh browser is sent to the login page", async ({ browser }) => {
    const visitor = await freshVisitor(browser, false);
    await visitor.page.goto("/#/");
    await expect(visitor.page).toHaveURL(/#\/login$/);
    await expect(visitor.page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(visitor.page.getByRole("link", { name: "Open kiosk view" })).toHaveCount(0);
    expect(visitor.backend.socketOpens).toBe(0);
    expect(visitor.backend.unhandled).toEqual([]);
    await visitor.close();
  });
});
