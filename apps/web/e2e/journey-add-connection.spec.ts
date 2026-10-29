/**
 * JOURNEY: an admin adds a device to the plant.
 *
 * From the overview: open Settings from the navigation, land on Devices, press
 * Add device, walk the wizard — pick the gateway the inverter already uses,
 * choose "Modbus device", describe a meter, confirm, Add — and see the new
 * device in the list the wizard returns to.
 *
 * The wizard's individual rules are `wizard-modbus-device.spec.ts`'s subject
 * (seeded unit id, role-dependent fields, the Solarman arm). What this one proves is
 * the round trip a user takes: that the Settings entry reaches the panel, the
 * panel's Add reaches the wizard, and the wizard's Add leaves the operator
 * looking at a list that CONTAINS what they made. The fake backend lists a
 * created device on the next `GET /api/devices`, as the real one does, so a
 * page that forgot to refetch after the add would show the old roster here.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const next = (page: Page) => page.getByRole("button", { name: "Next" });

/** The devices panel's list entry for one device, by its visible name. */
const deviceRow = (page: Page, name: string) =>
  page.locator("[data-device]").filter({ hasText: name });

test.describe("journey: add a device", () => {
  test("Settings → Devices → Add → wizard → the new device is in the list", async ({ page }) => {
    const { backend, consoleErrors } = await openPage(page, "/#/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");

    // ── 1. Settings, from the navigation, opens on Devices ──────────────────
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/#\/settings\/devices$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Devices");
    // The device about to be added is not there yet.
    await expect(deviceRow(page, "Cellar meter")).toHaveCount(0);
    const before = await page.locator("[data-device]").count();
    expect(before).toBeGreaterThan(0);

    // ── 2. Add device opens the wizard ──────────────────────────────────────
    // A LINK, not a button: a button would need its own navigation call, and
    // under the hash router a raw one escapes the ingress prefix and 404s.
    await expect(page.getByRole("button", { name: "Add device" })).toHaveCount(0);
    await page.getByRole("link", { name: "Add device" }).click();
    await expect(page).toHaveURL(/#\/settings\/devices\/add$/);
    await expect(page.getByRole("heading", { name: "Add to this plant" })).toBeVisible();
    // The wizard IS the screen — no dialog opened on the way.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // ── 3. Step 1: on the gateway the inverter already answers on ───────────
    await expect(next(page)).toBeDisabled();
    const connection = page.getByLabel("Connection", { exact: true });
    const inverterGateway = connection.locator("option", { hasText: "Inverter" }).first();
    await connection.selectOption({ label: (await inverterGateway.innerText()).trim() });
    await expect(next(page)).toBeEnabled();
    await next(page).click();

    // ── 4. Step 2: what is on it — a Modbus device ──────────────────────────
    await page.getByRole("button", { name: "Modbus device" }).click();
    await next(page).click();

    // ── 5. Step 3: describe the device ──────────────────────────────────────
    await page.getByLabel("Role").selectOption({ label: "Meter" });
    await page.getByLabel("Name", { exact: true }).fill("Cellar meter");
    await expect(next(page)).toBeDisabled();
    // Options read "<profile name> · <version or origin>"; the user picks by name.
    const profile = page.getByLabel("Profile");
    const sungrow = profile.locator("option", { hasText: "Sungrow SH10RT" });
    await profile.selectOption({ label: (await sungrow.innerText()).trim() });
    await expect(next(page)).toBeEnabled();
    await next(page).click();

    // ── 6. Confirm: the summary names what will be added ────────────────────
    await expect(page.getByText("Cellar meter")).toBeVisible();
    await expect(page.getByText("Sungrow SH10RT")).toBeVisible();
    // Named, not dumped: the old step ran `String()` over the answers bag.
    await expect(page.getByText("[object Object]")).toHaveCount(0);
    // Nothing written before the operator says Add.
    expect(backend.writes).toEqual([]);
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // ── 7. Back on the list, with the new device in it ──────────────────────
    await expect(page.getByText("Added.")).toBeVisible();
    await expect(page).toHaveURL(/#\/settings\/devices$/);
    await expect(deviceRow(page, "Cellar meter")).toBeVisible();
    await expect(page.locator("[data-device]")).toHaveCount(before + 1);

    // The one write the UI sent, and the shape it sent.
    expect(backend.writes).toEqual([
      {
        method: "POST",
        path: "/api/devices",
        body: {
          via: "profile",
          connection: { id: 1 },
          role: "meter",
          unitId: 0,
          name: "Cellar meter",
          profileId: "sungrow-sh10rt",
        },
      },
    ]);
    expect(backend.unhandled).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
