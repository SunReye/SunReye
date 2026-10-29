/**
 * JOURNEY: a session expires in the middle of using the dashboard.
 *
 * A signed-in user is reading History. Their session goes away server-side —
 * it expired, or an admin revoked it — and the client is not told. The next
 * thing they do makes a read, the read answers 401, and they land on the
 * sign-in form. They sign in again and get back to History.
 *
 * `auth-expired-session.spec.ts` proves the bounce in isolation (and that it
 * stays in the same document under ingress). This walks the whole recovery,
 * which nothing else does: that the sign-in form works from a bounced state,
 * that signing in lands back in the app, and that the app is usable again —
 * data loads, no second bounce.
 *
 * Sign-in always lands on the overview: the app does not remember the route
 * the 401 interrupted, so "returning to where they were" is the user's own
 * click on History. That is asserted as the current behaviour; a return-to
 * would change step 5, not the rest.
 */

import { expect, type Page, test } from "@playwright/test";
import { mockBackend } from "./support/api-mock";
import { mountedCharts, periodNavigator } from "./support/history";

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await page.getByRole("link", { name: label, exact: true }).click();
}

test.describe("journey: session expiry", () => {
  test("a 401 mid-session sends the user to sign in, and signing in gets them back", async ({
    page,
  }) => {
    const backend = await mockBackend(page);

    // ── 1. Signed in, reading History ───────────────────────────────────────
    await page.goto("/#/");
    await backend.waitForLive();
    await expect(heading(page)).toHaveText("Overview");
    await navigateTo(page, "History");
    await expect(heading(page)).toHaveText("History");
    await expect(mountedCharts(page).first()).toBeVisible();

    // ── 2. The session dies server-side; the client still believes in it ───
    backend.expireSession();

    // ── 3. The next thing the user does reads, gets a 401, and bounces ──────
    await periodNavigator(page).back.click();
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // ── 4. Sign in again ────────────────────────────────────────────────────
    await page.getByLabel("Email").fill("e2e@example.com");
    await page.getByLabel("Password").fill("correct horse battery staple");
    backend.resetRequests();
    await page.getByRole("button", { name: "Sign in" }).click();

    // ── 5. Back in the app, on the overview ─────────────────────────────────
    await expect(page).toHaveURL(/#\/$/);
    await expect(heading(page)).toHaveText("Overview");
    expect(
      backend.writes.filter((w) => w.path === "/api/auth/sign-in/email").map((w) => w.body),
    ).toContainEqual(expect.objectContaining({ email: "e2e@example.com" }));

    // ── 6. …and back to History, which loads, and stays put this time ───────
    await navigateTo(page, "History");
    await expect(heading(page)).toHaveText("History");
    await expect(mountedCharts(page).first()).toBeVisible();
    // Stepping the period reads again — now with a session it answers.
    await periodNavigator(page).back.click();
    await expect(periodNavigator(page).forward).toBeEnabled();
    await expect.poll(() => backend.requestCount("/api/history/rollup")).toBeGreaterThan(0);
    await expect(mountedCharts(page).first()).toBeVisible();
    await expect(page).toHaveURL(/#\/history$/);
    expect(backend.unhandled).toEqual([]);
  });
});
