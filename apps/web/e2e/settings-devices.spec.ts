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

/**
 * The "Edit connection" button of the nth group, in id order.
 *
 * There is more than one since #217 — the plant has a Modbus gateway AND an
 * MQTT broker — so an unscoped `getByRole` is a strict-mode violation, not a
 * click.
 */
const editConnection = (page: Page, index: number) =>
  page.getByRole("button", { name: "Edit connection" }).nth(index);

test.describe("the roster", () => {
  test("groups devices under their gateway, and the gateway is edited from its header", async ({
    page,
  }) => {
    const opened = await open(page);
    // One gateway in the fixture; its header carries the address and the cadence.
    await expect(
      page.getByRole("heading", { level: 2, name: "Inverter", exact: true }),
    ).toBeVisible();
    // A non-breaking space between the number and its unit: a plain one broke
    // "every 1" onto one line and "s" onto the next at phone width (#214).
    await expect(page.getByText(/Modbus TCP · 10\.0\.0\.5:502 · every 1\u00a0s/)).toBeVisible();
    await expect(page.locator("[data-group='gateway-1'] [data-device]")).toHaveCount(3);

    await editConnection(page, 0).click();
    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "Edit connection" })).toBeVisible();
    await expect(panel.getByLabel("Host")).toHaveValue("10.0.0.5");
    // The kind is shown, never offered: a PATCH carrying a different one is
    // answered 409, because every device below was provisioned for this tier.
    await expect(panel.getByText("Modbus gateway")).toBeVisible();
    await expect(panel.locator("select#connection-kind")).toHaveCount(0);
    // Three devices are bound, so there is nothing to delete.
    await expect(panel.getByRole("button", { name: "Delete" })).toHaveCount(0);

    // Test here is a port probe — is something listening at host:port — not a
    // register read; that one belongs to the device dialog, which has a profile.
    await panel.getByRole("button", { name: "Test connection" }).click();
    await expect(panel.getByText(/Reachable — port open, 12 ms/)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Captured snapshot" })).toHaveCount(0);
    await panel.getByLabel("Host").fill("10.0.0.7");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByText("Inverter saved.")).toBeVisible();
    expect(opened.backend.unhandled).toEqual([]);
    expect(opened.consoleErrors).toEqual([]);
  });

  test("editing a device opens the dialog on its own values and sends only the change", async ({
    page,
  }) => {
    const opened = await open(page);
    await page.locator("[data-device='meter']").getByRole("button", { name: "Edit" }).click();
    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "Edit device" })).toBeVisible();
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue("Meter");
    await expect(panel.getByLabel("Unit ID")).toHaveValue("2");
    await expect(panel.getByLabel("Profile")).toHaveValue("sungrow-sh10rt");
    // No "new connection" arm on an edit — a gateway is made from its own dialog.
    await expect(
      panel.getByLabel("Connection", { exact: true }).locator("option[value='new']"),
    ).toHaveCount(0);
    // Its own unit id is not shown as taken; the inverter's (1) is.
    await expect(panel.getByLabel("Unit ID").locator("option[value='2']")).toBeEnabled();
    await expect(panel.getByLabel("Unit ID").locator("option[value='1']")).toBeDisabled();

    const save = panel.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled(); // nothing changed yet
    await panel.getByLabel("Unit ID").selectOption("5");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByText("Meter updated.")).toBeVisible();
    expect(opened.backend.unhandled).toEqual([]);
    expect(opened.consoleErrors).toEqual([]);
  });

  test("an inverter's roof and pack are edited in its dialog; a meter has neither", async ({
    page,
  }) => {
    const opened = await open(page);
    // The row summarises what the dialog edits.
    await expect(page.locator("[data-device='inverter']").getByText("8.4 kWp")).toBeVisible();
    await expect(page.locator("[data-device='inverter']").getByText("10 kWh")).toBeVisible();

    await page.locator("[data-device='meter']").getByRole("button", { name: "Edit" }).click();
    let panel = dialog(page);
    await expect(panel.getByText("PV arrays")).toHaveCount(0);
    await panel.getByRole("button", { name: "Cancel" }).click();

    await page.locator("[data-device='inverter']").getByRole("button", { name: "Edit" }).click();
    panel = dialog(page);
    await expect(panel.getByLabel("Peak power (kWp)").first()).toHaveValue("8.4");
    await expect(panel.getByLabel("Usable battery (kWh)")).toHaveValue("10");
    const save = panel.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();

    await panel.getByRole("button", { name: "Add array" }).click();
    // Only the first row carries the column labels; later rows are reached by id.
    await panel.locator("#array-kwp-1").fill("3.2");
    await panel.getByLabel("Battery reserve (%)").fill("15");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByText("Inverter updated.")).toBeVisible();
    expect(opened.backend.unhandled).toEqual([]);
    expect(opened.consoleErrors).toEqual([]);
  });

  test("lists every device with its state, retired ones included", async ({ page }) => {
    const opened = await open(page);
    const inverter = page.locator("[data-device='inverter']");
    // The polled device carries NO badge: a green pill on the one row that is
    // working is the state nobody acts on. Every state that is not the healthy
    // one still speaks, which the meter and the retired row below prove.
    await expect(inverter.getByText("Polling")).toHaveCount(0);
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

  /**
   * #213 gave a coded device its own group; #217 gave it an ENDPOINT.
   *
   * The loadpoints are bound to the broker they arrive on, so they belong to
   * that connection's group — there is no "Integrations" group beside it any
   * more. Before the schema change they sat at `connection_id = null` and
   * shared `unit_id = 0`, which the `devices(connection_id, unit_id)` unique
   * index tolerated only because the connection was null.
   *
   * What #213 decided still holds on the rows themselves: no Modbus polling
   * hint, no red profile flag, and no Edit or Retire.
   */
  test("loadpoints sit under their broker, the optimizer under Internal, and neither is edited here", async ({
    page,
  }) => {
    const opened = await open(page);

    // Neither is an orphan: "No connection" is for a device with no endpoint
    // and no reason for it, and nothing in the fixture is one.
    await expect(page.getByRole("heading", { level: 2, name: "No connection" })).toHaveCount(0);
    // The group is the BROKER, labelled by its kind and the host it dials.
    await expect(
      page.getByRole("heading", { level: 2, name: "Home broker", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("MQTT · hass.ee.lan")).toBeVisible();
    // Both loadpoints are on the broker's card — nested UNDER the EVCC ingest
    // that provided them rather than floating above it as siblings, which is
    // `settings-integrations.spec.ts`'s subject. Nothing is read straight
    // through the broker, so its own top-half group does not exist at all.
    await expect(page.locator("[data-group='gateway-2']")).toHaveCount(0);
    await expect(page.locator("[data-provided-by='1'] [data-device]")).toHaveCount(2);
    // The device locator must not pick up the integration rows sharing the card.
    await expect(page.locator("[data-integrations] [data-integration]")).toHaveCount(2);
    await expect(page.locator("[data-group='integration-evcc']")).toHaveCount(0);

    await expect(
      page.getByRole("heading", { level: 2, name: "Internal", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-group='internal'] [data-device]")).toHaveCount(1);

    const carport = page.locator("[data-device='evcc-loadpoint-1']");
    await expect(carport).toBeVisible();
    await expect(page.locator("[data-device='evcc-loadpoint-2']")).toBeVisible();
    await expect(carport.getByText("via MQTT")).toBeVisible();
    // Neither the red profile flag nor the Modbus polling hint belongs on it.
    await expect(carport.getByText(/Profile not installed/)).toHaveCount(0);
    await expect(carport.getByText("Not polled")).toHaveCount(0);
    // #219 narrowed the coded/virtual PATCH gate to TOPOLOGY — which gateway,
    // which slave id, which driver — so a loadpoint can be renamed and retired
    // like anything else. What it still cannot have is the ADDRESSING dialog,
    // which asks for all three; before the narrowing the whole PATCH was
    // refused and the row offered a link and nothing else.
    await expect(carport.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(carport.getByRole("button", { name: "Rename" })).toBeVisible();
    await expect(carport.getByRole("button", { name: "Retire" })).toBeVisible();
    // No "Configure" link on the row: what provides this loadpoint is the
    // integration the row now hangs UNDER, whose own name is the link into it.
    // `settings-integrations.spec.ts` is that half.
    await expect(carport.getByRole("link", { name: "Configure" })).toHaveCount(0);
    await expect(page.locator("[data-integration='evcc-ingest']")).toBeVisible();

    const optimizer = page.locator("[data-device='optimizer']");
    await expect(optimizer.getByText("internal", { exact: true })).toBeVisible();
    await expect(optimizer.getByText("Optimizer", { exact: true }).first()).toBeVisible();
    await expect(optimizer.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(optimizer.getByRole("button", { name: "Retire" })).toHaveCount(0);
    // Nothing to configure: it is this server's own control loop.
    await expect(optimizer.getByRole("link", { name: "Configure" })).toHaveCount(0);
    expect(opened.consoleErrors).toEqual([]);
  });

  /**
   * #217: a broker is added HERE, on its own.
   *
   * `POST /api/devices`'s `connection: { create }` arm can only make a
   * connection alongside a device, and a broker has none at creation time — its
   * loadpoints appear after the EVCC ingest is bound to it and its first message
   * lands. Without a way to add one, the whole feature is unreachable from the
   * UI.
   */
  test("an MQTT broker is added from the panel, and its fields replace the Modbus ones", async ({
    page,
  }) => {
    const opened = await open(page);
    await page.getByRole("button", { name: "Add connection" }).click();
    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "Add a connection" })).toBeVisible();

    // Opens on Modbus, and the save waits for a name.
    const save = panel.getByRole("button", { name: "Save" });
    await expect(panel.getByLabel("Host")).toBeVisible();
    await expect(save).toBeDisabled();

    await panel.getByLabel("Kind").selectOption("mqtt");
    // The kind switch swaps the field SET, it does not add to it.
    await expect(panel.getByLabel("Host")).toHaveCount(0);
    await expect(panel.getByLabel("Broker URL")).toBeVisible();
    await expect(panel.getByLabel("Client ID")).toBeVisible();

    await panel.getByLabel("Connection name").fill("Cellar broker");
    await expect(save).toBeDisabled(); // no broker URL yet
    await panel.getByLabel("Broker URL").fill("mqtt://10.0.0.4:1883");
    await expect(save).toBeEnabled();

    // The probe is the broker's, not a port knock: it dials an MQTT CONNECT.
    await panel.getByRole("button", { name: "Test connection" }).click();
    await expect(panel.getByText(/Broker reachable — connected in 12 ms/)).toBeVisible();

    await save.click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByText("Cellar broker added.")).toBeVisible();
    expect(opened.backend.unhandled).toEqual([]);
    expect(opened.consoleErrors).toEqual([]);
  });
});

/**
 * ADDING is a route now, not a dialog.
 *
 * "Add device" used to open a modal that could only ever add a MODBUS device —
 * contractually, since its body required a `unitId` and a `profileId` — so a
 * broker's integrations had no entry point at all. It is a link to the four-step
 * wizard at `/settings/devices/add`, because four questions is more than a modal
 * holds at 400px and the browser's Back has to mean "the previous screen".
 *
 * What the wizard then does is its own spec's subject. What belongs HERE is the
 * one thing the panel still owns: that its Add reaches it. The dialog is still
 * mounted below for EDITING, which "editing a device…" above covers.
 */
test.describe("adding", () => {
  test("the panel's Add is a link to the wizard, and lands on it", async ({ page }) => {
    const opened = await open(page);
    const add = page.getByRole("link", { name: "Add device" });
    // A LINK, not a button: a button here would need its own navigation call,
    // and under the hash router a raw one escapes the ingress prefix and 404s.
    await expect(add).toBeVisible();
    await expect(page.getByRole("button", { name: "Add device" })).toHaveCount(0);

    await add.click();
    await expect(page).toHaveURL(/#\/settings\/devices\/add$/);
    await expect(page.getByRole("heading", { name: "Add to this plant" })).toBeVisible();
    // No dialog opened on the way: the wizard IS the screen.
    await expect(dialog(page)).toHaveCount(0);
    expect(opened.backend.unhandled).toEqual([]);
    expect(opened.consoleErrors).toEqual([]);
  });
});
