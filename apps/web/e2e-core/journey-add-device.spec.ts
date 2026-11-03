/**
 * JOURNEY, against the real core binary: the admin adds a second device on a new connection through the
 * add wizard, and the roster lists both.
 *
 * Starts from the core the onboarding journey left: its admin and its one device. The new connection is
 * this spec's simulator, so the connection test and the unit-id scan are answered by a device. The added
 * device is retired at the end, so the journeys after this one read a one-device plant.
 */

import type { ChildProcess } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { PROFILE, heading, signIn, startSimulator } from "./support/core";

let simulator: { child: ChildProcess; port: number };
test.beforeAll(async () => {
  simulator = await startSimulator();
});
test.afterAll(() => {
  simulator.child.kill();
});

const next = (page: Page) => page.getByRole("button", { name: "Next" });
const rows = (page: Page) => page.locator("[data-device]");

test("the admin adds a device on a new connection, the roster lists both, and the new one retires", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/#/settings/devices");
  await expect(heading(page)).toHaveText("Devices");
  await expect(rows(page)).toHaveCount(1);

  // ── 1. A new connection: the simulator's address, tested before it is saved ──
  await page.getByRole("link", { name: "Add device" }).click();
  await page.locator("select#wizard-connection").selectOption("new");
  // The core serves no MQTT broker, so the kind is stated, not offered.
  await expect(page.locator("select#connection-kind")).toHaveCount(0);
  await page.getByLabel("Connection name").fill("Garage");
  await page.getByLabel("Host").fill("127.0.0.1");
  await page.getByLabel("Port", { exact: true }).fill(String(simulator.port));
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/^Reachable — port open/)).toBeVisible();
  await next(page).click();

  // ── 2. A Modbus device, the one thing a core without integrations attaches ──
  await page.getByRole("button", { name: "Modbus device" }).click();
  await next(page).click();

  // ── 3. Described, its unit id found by asking the device ─────────────────
  await page.locator("select#device-role").selectOption("meter");
  await page.locator("#device-name").fill("Garage meter");
  await page.locator("select#device-profile").selectOption(PROFILE);
  await page.getByRole("button", { name: "Find it" }).click();
  await expect(page.getByText(/^Unit 1 answered in \d+ ms\.$/)).toBeVisible();
  await expect(page.locator("select#device-unit")).toHaveValue("1");
  await next(page).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // ── 4. Back on the roster, both devices listed ───────────────────────────
  await expect(page.getByText("Added.")).toBeVisible();
  await expect(page).toHaveURL(/#\/settings\/devices$/);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).filter({ hasText: "Garage meter" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Garage" })).toBeVisible();

  // ── 5. Retired from its row: kept, folded away, no longer polled ─────────
  await page.getByRole("button", { name: "More actions for Garage meter" }).click();
  await page.getByRole("menuitem", { name: "Retire" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retire" }).click();
  await expect(page.getByText("Garage meter updated.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retired (1)" })).toBeVisible();
});
