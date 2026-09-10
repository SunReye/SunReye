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

/**
 * THE RESTRUCTURED CARD — the owner's complaint, as a test.
 *
 * What shipped read: "MQTT · hass.ee.lan / Carport / Charger / via MQTT /
 * evcc-loadpoint-1 / EVCC loadpoint / Unit 1 / Integrations / Home Assistant
 * export / Enabled / ha-export / EVCC / Enabled / evcc-ingest". Three faults,
 * and they are one fault: the raw identifiers are on the primary surface, and
 * the provided device is a SIBLING of the thing that provided it.
 *
 * A browser claim rather than a unit one because the nesting is a resolved
 * document: `nestIntegrations` decides which device belongs to which row (in
 * milliseconds, in `add-device-logic.test.ts`), and what only exists here is
 * whether the card actually draws it that way.
 */
test("the broker's loadpoints hang UNDER the ingest that provided them", async ({ page }) => {
  const opened = await open(page);

  // Nothing is read straight through the broker, so the top half of its card is
  // empty and there is no `data-group` for it at all.
  await expect(page.locator("[data-group='gateway-2']")).toHaveCount(0);
  // Both loadpoints are inside the EVCC row's own subtree, keyed by the
  // integration's id — not floating above it as siblings.
  const provided = page.locator("[data-provided-by='1'] [data-device]");
  await expect(provided).toHaveCount(2);
  await expect(provided.filter({ hasText: "Carport" })).toBeVisible();
  await expect(provided.filter({ hasText: "Garage" })).toBeVisible();
  // The export provisions nothing, so its row owns nothing.
  await expect(page.locator("[data-provided-by='2'] [data-device]")).toHaveCount(0);

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

/**
 * THE SLUGS ARE OFF THE PRIMARY SURFACE.
 *
 * `evcc-ingest` and `ha-export` are kind keys, `evcc-loadpoint-1` is a frozen
 * device slug, and none of the three is what a human calls the thing — the
 * labels beside them already say "EVCC" and "Home Assistant export". Asserted
 * as an absence from the card's rendered TEXT (not from a locator that a moved
 * element would silently empty), plus the presence of what replaced them: the
 * observed connection state.
 */
test("no kind key and no device slug survives on the card", async ({ page }) => {
  await open(page);
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Home broker", exact: true }) })
    .last();
  const text = await card.innerText();

  expect(text).not.toContain("evcc-ingest");
  expect(text).not.toContain("ha-export");
  expect(text).not.toContain("evcc-loadpoint-1");
  expect(text).not.toContain("evcc-loadpoint-2");
  // The names, the roles and the profile stay: those are what tell two rows
  // apart, and dropping them would have been the opposite mistake.
  expect(text).toContain("Carport");
  expect(text).toContain("Garage");
  expect(text).toContain("EVCC loadpoint");

  // What the kind key's line became: what is OBSERVED of the endpoint. The
  // fixture's ingest is connected, its export has never opened once — two
  // different sentences, because they are two different faults.
  await expect(
    page.locator("[data-integration='evcc-ingest']").getByText("Connected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("[data-integration='ha-export']").getByText("Never connected"),
  ).toBeVisible();
});

// A loadpoint's `unit_id` is its index in EVCC's config, not a slave address,
// and nothing addresses it by that number — it was pure noise beside a name.
// The Modbus meter keeps its unit id, because there it is the addressing.
test("a unit id stays only where something is addressed by one", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-device='meter']").getByText("Unit 2")).toBeVisible();
  await expect(page.locator("[data-device='evcc-loadpoint-1']").getByText(/Unit /)).toHaveCount(0);
  await expect(page.locator("[data-device='optimizer']").getByText(/Unit /)).toHaveCount(0);
});

// The row's name is the way in. An integration has an inside now — its live
// status, its settings and the devices it provides — and this is the click that
// reaches it.
test("an integration's name opens its own page", async ({ page }) => {
  const opened = await open(page);
  await page
    .locator("[data-integration='evcc-ingest']")
    .getByRole("link", { name: "EVCC" })
    .click();
  await expect(page).toHaveURL(/#\/settings\/integrations\/1$/);
  await expect(page.getByRole("heading", { level: 2, name: "EVCC", exact: true })).toBeVisible();
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
