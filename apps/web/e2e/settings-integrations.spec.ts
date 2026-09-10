/**
 * Settings → Devices: the INTEGRATIONS half of a connection's card.
 *
 * This spec used to live on `/settings/mqtt`, a tab of two forms writing
 * `app_settings`. That tab is gone: an integration is a row of `integrations`
 * now, and it belongs on the page that answers "what is on this endpoint" —
 * beside the devices that read through the same connection. An operator looking
 * at a broker used to see its loadpoints and no sign of the EVCC ingest that
 * provisioned them.
 *
 * A browser claim because the row is a running document: a switch that writes
 * on change, a dialog seeded from the ROW's stored settings rather than the
 * catalog's defaults, and a confirm that has to name devices it works out from
 * two separately-fetched lists. What each function decides
 * (`add-device-logic.test.ts`) is proven in milliseconds; what only exists here
 * is whether the bindings wire them to the controls, and what actually goes on
 * the wire.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const open = (page: Page) => openPage(page, "/#/settings/devices");
const dialog = (page: Page) => page.getByRole("dialog");

/** The one request a control makes, as a parsed body. */
async function capture(page: Page, method: string, act: () => Promise<void>) {
  const request = page.waitForRequest(
    (r) => r.method() === method && r.url().includes("/api/integrations/"),
  );
  await act();
  const seen = await request;
  return { url: seen.url(), body: seen.postDataJSON() as Record<string, unknown> | null };
}

const rows = (page: Page) => page.locator("[data-integrations] [data-integration]");

test("the broker's card lists what runs over it, under what reads through it", async ({ page }) => {
  const opened = await open(page);

  // The broker group holds BOTH halves: two loadpoints and, below them, the two
  // integration rows. The devices are addressed by `data-device`, the
  // integrations by `data-integration`, so neither locator can pick up the other.
  const broker = page.locator("[data-group='gateway-2']");
  await expect(broker.locator("[data-device]")).toHaveCount(2);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator("[data-integration='evcc-ingest']")).toBeVisible();
  await expect(page.locator("[data-integration='ha-export']")).toBeVisible();

  // A row's PRESENCE is its configuration, and `enabled` is the off switch —
  // the fixture has one of each so both states render.
  await expect(page.locator("[data-integration='evcc-ingest']").getByText("Enabled")).toBeVisible();
  await expect(page.locator("[data-integration='ha-export']").getByText("Disabled")).toBeVisible();

  // Nothing hangs off the Modbus gateway, and its card says nothing about
  // integrations rather than rendering an empty heading.
  await expect(page.locator("[data-group='gateway-1'] [data-integrations]")).toHaveCount(0);
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

test("the switch turns one off with a PATCH carrying nothing but `enabled`", async ({ page }) => {
  const opened = await open(page);
  const row = page.locator("[data-integration='evcc-ingest']");
  const toggle = row.getByRole("switch");
  await expect(toggle).toBeChecked();

  const sent = await capture(page, "PATCH", () => toggle.click());
  expect(sent.url).toContain("/api/integrations/1");
  // Never a `kind` or a `connectionId`: those are the row's identity and the
  // server answers 409 for either.
  expect(sent.body).toEqual({ enabled: false });
  await expect(page.getByText("EVCC saved.")).toBeVisible();
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

test("Edit opens on the row's own settings and saves them as params", async ({ page }) => {
  const opened = await open(page);
  await page
    .locator("[data-integration='evcc-ingest']")
    .getByRole("button", { name: "Edit" })
    .click();
  const panel = dialog(page);
  await expect(panel.getByRole("heading", { name: "Configure EVCC" })).toBeVisible();

  // Seeded from the ROW, not from the catalog's default: this is an edit, and a
  // form that reset to `evcc` would silently undo an operator's topic root.
  const topicRoot = panel.getByLabel("Topic root");
  await expect(topicRoot).toHaveValue("evcc");
  await topicRoot.fill("wallbox");

  const sent = await capture(page, "PATCH", () =>
    panel.getByRole("button", { name: "Save" }).click(),
  );
  expect(sent.url).toContain("/api/integrations/1");
  expect(sent.body).toEqual({ params: { topicRoot: "wallbox" } });
  await expect(panel).toHaveCount(0);
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

test("the export's own fields come from the catalog, and the row it edits is its own", async ({
  page,
}) => {
  await open(page);
  await page
    .locator("[data-integration='ha-export']")
    .getByRole("button", { name: "Edit" })
    .click();
  const panel = dialog(page);
  await expect(
    panel.getByRole("heading", { name: "Configure Home Assistant export" }),
  ).toBeVisible();

  // Three fields, rendered from the server's own description of them — the type
  // picks the control, so the boolean is a checkbox and not a text box.
  await expect(panel.getByLabel("Topic prefix")).toHaveValue("sunreye");
  await expect(panel.getByLabel("Discovery prefix")).toHaveValue("homeassistant");
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  // The EVCC row's field is not on this form: each row edits its own kind.
  await expect(panel.getByLabel("Topic root")).toHaveCount(0);
});

/**
 * The surprise this dialog exists to prevent.
 *
 * `DELETE /api/integrations/:id` RETIRES the devices the integration
 * provisioned — an EVCC ingest's loadpoints — because their readings are a
 * foreign key away from a year of `metrics_raw` rows. Nothing on the row lets
 * the operator see that coming, so the confirm has to say it, by name.
 */
test("Remove names the devices it retires, and only then deletes", async ({ page }) => {
  const opened = await open(page);
  await page
    .locator("[data-integration='evcc-ingest']")
    .getByRole("button", { name: "Remove" })
    .click();
  const panel = dialog(page);
  await expect(panel.getByRole("heading", { name: "Remove EVCC?" })).toBeVisible();

  const warning = panel.locator("[data-retires]");
  await expect(warning).toContainText("Carport");
  await expect(warning).toContainText("Garage");

  const sent = await capture(page, "DELETE", () =>
    panel.getByRole("button", { name: "Remove" }).click(),
  );
  expect(sent.url).toContain("/api/integrations/1");
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("EVCC removed.")).toBeVisible();
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

// The Home Assistant export publishes and provisions nothing, so its Remove is
// just a Remove. The absence is the assertion: a dialog that named a device here
// would be promising a retirement that will not happen.
test("an integration that provisions nothing warns about nothing", async ({ page }) => {
  await open(page);
  await page
    .locator("[data-integration='ha-export']")
    .getByRole("button", { name: "Remove" })
    .click();
  const panel = dialog(page);
  await expect(panel.getByRole("heading", { name: "Remove Home Assistant export?" })).toBeVisible();
  await expect(panel.locator("[data-retires]")).toHaveCount(0);
});
