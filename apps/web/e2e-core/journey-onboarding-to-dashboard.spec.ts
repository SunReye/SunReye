/**
 * JOURNEY, against the real core binary and the simulator: the first visitor creates the admin, onboards
 * a device, and the dashboard shows what the device answers.
 *
 * The values are the oracle fixture's, read from the file the simulator replays, so the expectation
 * and the simulator share a source but the dashboard's formatting stays the spec's independent claim.
 */

import type { ChildProcess } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN, PROFILE, heading, oracleReadings, powerFlow, startSimulator } from "./support/core";

/** Pick one profile from the setup list, found through its name since the groups may be collapsed. */
async function selectProfile(page: Page, id: string): Promise<void> {
  const profiles = await page.request.get("/api/profiles");
  const { name } = ((await profiles.json()) as { id: string; name: string }[]).find(
    (p) => p.id === id,
  )!;
  await page.getByPlaceholder(/search/i).fill(name);
  const row = page
    .locator("div")
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Select", exact: true }) })
    .last();
  await row.getByRole("button", { name: "Select", exact: true }).click();
}

let simulator: { child: ChildProcess; port: number };
test.beforeAll(async () => {
  simulator = await startSimulator();
});
test.afterAll(() => {
  simulator.child.kill();
});

test("first-run admin, onboard a device, then live values on the dashboard", async ({ page }) => {
  // ── 1. A fresh core: any address ends on the sign-up form ────────────────
  await page.goto("/#/");
  await expect(page).toHaveURL(/#\/onboarding$/);
  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create account" }).click();

  // ── 2. The admin has no profile yet: setup, step 1 ───────────────────────
  await expect(page).toHaveURL(/#\/setup$/);
  await expect(heading(page)).toHaveText("Set up your inverter");
  await selectProfile(page, PROFILE);
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 3. The connection is the simulator's address ─────────────────────────
  await page.getByLabel("Host").fill("127.0.0.1");
  await page.getByLabel("Port").fill(String(simulator.port));
  await page.getByLabel("Unit ID").fill("1");
  await page.getByLabel("Poll interval (ms)").fill("1000");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/^Connection OK/)).toBeVisible();
  // A successful test opens the captured snapshot over the form.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Continue" }).click();

  // ── 4. Activate: the core polls at once, so the dashboard follows ────────
  await page.getByRole("button", { name: "Activate profile" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(heading(page)).toHaveText("Overview");

  // ── 5. Live values: the simulator's readings, arriving over /ws ──────────
  const want = oracleReadings();
  const usa = (n: number) => n.toLocaleString("en-US");
  const diagram = powerFlow(page);
  for (const shown of [
    usa(want["dc.pv1.power"]!),
    `${want["battery.soc"]}%`,
    usa(want["ac.total_power"]!),
    usa(want["ac.ups.total_power"]!),
  ]) {
    await expect(diagram).toContainText(shown, { timeout: 30_000 });
  }
});
