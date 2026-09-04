/**
 * Settings → Devices: the roster and the add-device dialog.
 *
 * A browser claim because the dialog is a running document — native `<select>`s
 * bound to form state, a "new connection" branch that appears on one option,
 * a submit button whose `disabled` follows a derived body, and a server
 * refusal that has to land under the field it names. The rules themselves
 * (`add-device-logic.test.ts`) are proven in milliseconds; what only exists
 * here is whether the bindings wire them to the controls.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const open = (page: Page) => openPage(page, "/#/settings/devices");
const dialog = (page: Page) => page.getByRole("dialog");

test.describe("the roster", () => {
  test("lists every device with its state, retired ones included", async ({ page }) => {
    const opened = await open(page);
    const inverter = page.locator("[data-device='inverter']");
    await expect(inverter.getByText("Polling")).toBeVisible();
    // The polled device cannot be retired from here.
    await expect(inverter.getByRole("button", { name: "Retire" })).toBeDisabled();

    const meter = page.locator("[data-device='meter']");
    await expect(meter.getByText("Not polled")).toBeVisible();
    await expect(meter.getByText("Unit 2")).toBeVisible();

    const old = page.locator("[data-device='old-inverter']");
    await expect(old.getByText("Retired")).toBeVisible();
    await expect(old.getByText(/Profile not installed/)).toBeVisible();
    await expect(old.getByRole("button", { name: "Restore" })).toBeVisible();
    expect(opened.consoleErrors).toEqual([]);
  });
});

test.describe("adding a device", () => {
  test("the dialog opens on the existing gateway and the submit waits for a name and a profile", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Add device" }).click();
    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "Add a device" })).toBeVisible();

    const connection = panel.getByLabel("Connection", { exact: true });
    await expect(connection).toHaveValue("1");
    // Nothing to send yet: no name, no profile.
    const submit = panel.getByRole("button", { name: "Add device" });
    await expect(submit).toBeDisabled();

    // Units 1 and 2 are taken on this gateway (the inverter and the meter), so
    // the picker offers them disabled and defaults to the first free id — 0.
    const unit = panel.getByLabel("Unit ID");
    await expect(unit).toHaveValue("0");
    await expect(unit.locator("option[value='2']")).toBeDisabled();
    await expect(unit.locator("option[value='4']")).toBeEnabled();
    await unit.selectOption("4");
    await expect(unit).toHaveValue("4");

    await panel.getByLabel("Name", { exact: true }).fill("Zähler Süd");
    await expect(panel.getByText("Slug: zahler-sud")).toBeVisible();
    await expect(submit).toBeDisabled();

    await panel.getByLabel("Profile").selectOption("sungrow-sh10rt");
    await expect(submit).toBeEnabled();
  });

  test("choosing a new connection reveals its fields, and the device lands in the list", async ({
    page,
  }) => {
    const opened = await open(page);
    await page.getByRole("button", { name: "Add device" }).click();
    const panel = dialog(page);

    await expect(panel.getByLabel("Host")).toHaveCount(0);
    await panel.getByLabel("Connection", { exact: true }).selectOption("new");
    await expect(panel.getByLabel("Connection name")).toHaveValue("Gateway 2");
    await expect(panel.getByLabel("Host")).toBeVisible();

    await panel.getByLabel("Role").selectOption("meter");
    await panel.getByLabel("Name", { exact: true }).fill("Keller");
    await panel.getByLabel("Profile").selectOption("sungrow-sh10rt");
    const submit = panel.getByRole("button", { name: "Add device" });
    // A new connection with no host is not sendable.
    await expect(submit).toBeDisabled();
    await panel.getByLabel("Host").fill("10.0.0.9");
    await expect(submit).toBeEnabled();

    await submit.click();
    await expect(panel).toHaveCount(0);
    // The list reloads from the mock, which serves its fixed roster; the
    // toast is what proves the POST answered with the echoed device.
    await expect(page.getByText("Keller added.")).toBeVisible();
    expect(opened.backend.unhandled).toEqual([]);
    expect(opened.consoleErrors).toEqual([]);
  });
});
