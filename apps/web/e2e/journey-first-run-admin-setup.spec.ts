/**
 * JOURNEY: the first visitor to a fresh install creates the administrator.
 *
 * A fresh core has no accounts. Whatever address the visitor opens, they end on
 * the sign-up form; creating the account signs them in as the admin and
 * continues to inverter setup, because the core has no active profile yet. A
 * second sign-up is refused once the account exists.
 *
 * The form's field rules are `AuthForm.svelte.test.ts`'s subject; what only a
 * running app proves is the redirect chain through the gates and that the
 * session the sign-up started is the one the shell reads next.
 */

import { expect, test } from "@playwright/test";
import { mockBackend } from "./support/api-mock";

test.describe("journey: first-run admin setup", () => {
  test("a fresh install sends the visitor to sign-up, which creates the admin and continues to setup", async ({
    page,
  }) => {
    const backend = await mockBackend(page, { role: null, needsSetup: true, needsProfile: true });

    // ── 1. Any address lands on the sign-up form ────────────────────────────
    await page.goto("/#/");
    await expect(page).toHaveURL(/#\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to SunReye");

    // ── 2. Create the administrator ─────────────────────────────────────────
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password").fill("analytical-engine");
    await page.getByRole("button", { name: "Create account" }).click();

    // ── 3. Signed in, and on to the inverter step ───────────────────────────
    await expect(page).toHaveURL(/#\/setup$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up your inverter");
    expect(backend.writes.filter((w) => w.path === "/api/auth/sign-up").map((w) => w.body)).toEqual(
      [{ name: "Ada Lovelace", email: "ada@example.com", password: "analytical-engine" }],
    );

    // ── 4. Registration is closed behind the first account ──────────────────
    await page.goto("/#/onboarding");
    await expect(page).toHaveURL(/#\/login$/);
    expect(backend.unhandled).toEqual([]);
  });
});
