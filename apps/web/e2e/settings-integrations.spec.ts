/**
 * Settings → Integrations: the Home Assistant export and the EVCC ingest, each
 * naming a broker CONNECTION.
 *
 * A browser claim because the card is a running document: two native selects
 * over a list fetched from `/api/connections`, a discovery prefix that only
 * exists while a switch is on, and a save button whose `disabled` follows two
 * derived bodies at once. The mappings themselves (`mqtt-config-form.test.ts`)
 * are proven in milliseconds; what only exists here is whether the bindings
 * wire them to the controls — and, in particular, that the PUT carries a
 * `connectionId` and NOT the `brokerUrl`/`username`/`password` the panel used
 * to send (#217).
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const open = (page: Page) => openPage(page, "/#/settings/mqtt");

/** The one PUT the save button makes for a record, as a parsed body. */
async function capturePut(page: Page, path: string, act: () => Promise<void>) {
  const request = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().includes(`/api/settings/${path}`),
  );
  await act();
  return (await request).postDataJSON() as Record<string, unknown>;
}

test("the export card names a broker connection, and saves the id — never a URL", async ({
  page,
}) => {
  const opened = await open(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "Home Assistant discovery" }),
  ).toBeVisible();

  // No broker fields on this page at all any more: the endpoint is a
  // connection, and its password is masked by `/api/connections`.
  await expect(page.getByLabel("Broker URL")).toHaveCount(0);
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await expect(page.getByLabel("Password")).toHaveCount(0);

  // The fixture leaves the export unbound — a null connection IS "off".
  const broker = page.locator("select#mqtt-broker");
  await expect(broker).toHaveValue("");
  // Only the `kind = 'mqtt'` connections are offered; the Modbus gateway is not.
  await expect(broker.locator("option")).toHaveText([
    "Off — nothing is published",
    "Home broker · hass.ee.lan",
  ]);

  await broker.selectOption("2");
  await page.getByLabel("Topic prefix").fill("haus");
  const body = await capturePut(page, "mqtt", () =>
    page.getByRole("button", { name: "Save" }).click(),
  );
  expect(body).toEqual({
    connectionId: 2,
    topicPrefix: "haus",
    haDiscoveryEnabled: false,
    haDiscoveryPrefix: "homeassistant",
  });
  await expect(page.getByText("MQTT settings saved — applied live")).toBeVisible();
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

test("the discovery prefix appears with the switch, and a blank one blocks the save", async ({
  page,
}) => {
  await open(page);
  const prefix = page.getByLabel("Discovery prefix");
  await expect(prefix).toHaveCount(0);

  await page.getByRole("switch").first().click();
  await expect(prefix).toBeVisible();
  await expect(prefix).toHaveValue("homeassistant");

  // `min(1)` on the server, so a blank one is a 400 rather than a default.
  const save = page.getByRole("button", { name: "Save" });
  await prefix.fill("");
  await expect(save).toBeDisabled();
  await prefix.fill("ha");
  await expect(save).toBeEnabled();
});

test("EVCC keeps its OWN broker connection, and its knobs stay on this tab", async ({ page }) => {
  const opened = await open(page);
  await expect(page.getByRole("heading", { level: 2, name: "EVCC" })).toBeVisible();

  // Its own select, already bound by the fixture — the ingest and the export
  // may name different brokers, which is the whole point of #217.
  const evccBroker = page.locator("select#evcc-broker");
  await expect(evccBroker).toHaveValue("2");
  await expect(page.getByLabel("Topic root")).toHaveValue("evcc");

  await page.getByLabel("Topic root").fill("wallbox");
  const body = await capturePut(page, "evcc", () =>
    page.getByRole("button", { name: "Save" }).click(),
  );
  expect(body).toEqual({
    enabled: true,
    connectionId: 2,
    topicRoot: "wallbox",
    subtractFromHome: false,
  });
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});
