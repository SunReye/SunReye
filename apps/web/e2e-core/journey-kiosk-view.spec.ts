/**
 * JOURNEY, against the real core binary: the admin switches the kiosk view on, a fresh browser reads
 * the live dashboard without signing in and cannot write; switched off, the same browser is sent to
 * the login page.
 *
 * Starts from the core the onboarding journey left: its admin, its device. The device is pointed at
 * this spec's simulator, so the value on screen is the oracle fixture's.
 */

import type { ChildProcess } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { heading, oracleReadings, powerFlow, signIn, startSimulator } from "./support/core";

let simulator: { child: ChildProcess; port: number };
test.beforeAll(async () => {
  simulator = await startSimulator();
});
test.afterAll(() => {
  simulator.child.kill();
});

/** Points the stored device at this spec's simulator. */
async function pollSimulator(page: Page, port: number): Promise<void> {
  const inverter = await (await page.request.get("/api/settings/inverter")).json();
  const saved = await page.request.put("/api/settings/inverter", {
    data: { ...inverter, port },
    // The core refuses a write without its own origin.
    headers: { origin: new URL(page.url()).origin },
  });
  expect(saved.status()).toBe(200);
}

async function switchKiosk(page: Page, on: boolean): Promise<void> {
  await page.goto("/#/settings/access");
  const toggle = page.getByRole("switch", { name: "Kiosk view" });
  await expect(toggle).toBeChecked({ checked: !on });
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: on });
}

test("the admin switches the kiosk view on, a fresh browser reads the dashboard, and off sends it to login", async ({
  page,
  browser,
}) => {
  // ── 1. The admin signs in and switches the kiosk view on ─────────────────
  await signIn(page);
  await pollSimulator(page, simulator.port);
  await switchKiosk(page, true);

  // ── 2. A fresh browser: no cookie, the overview live ─────────────────────
  const context = await browser.newContext();
  const visitor = await context.newPage();
  const writes: string[] = [];
  visitor.on("request", (request) => {
    const method = request.method();
    if (method !== "GET" && method !== "HEAD") writes.push(`${method} ${request.url()}`);
  });
  await visitor.goto("/#/");
  await expect(heading(visitor)).toHaveText("Overview");
  await expect(powerFlow(visitor)).toContainText(`${oracleReadings()["battery.soc"]}%`, {
    timeout: 30_000,
  });

  // ── 3. Read-only: no settings, no sign-out, no write controls ────────────
  await visitor.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(visitor.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(visitor.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(visitor.getByRole("switch")).toHaveCount(0);
  await expect(visitor.getByRole("textbox")).toHaveCount(0);
  await visitor.goto("/#/settings/access");
  await expect(visitor).toHaveURL(/#\/$/);
  expect(writes).toEqual([]);

  // ── 4. Switched off, the same browser lands on the login page ────────────
  await switchKiosk(page, false);
  await visitor.reload();
  await expect(visitor).toHaveURL(/#\/login$/);
  await expect(visitor.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Open kiosk view" })).toHaveCount(0);
  await context.close();
});
