import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import Dashboard from "../dashboard/Dashboard.svelte";
import type { Connection } from "../api/core.ts";
import { FakeCore } from "./devices.harness.ts";
import Routed from "./routed.harness.svelte";

/** A phone; levels land at once. */
beforeEach(async () => {
  await page.viewport(390, 800);
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  // The levels move the hash.
  history.replaceState(null, "", location.pathname + location.search);
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** Settings › `group`, as the admin. */
function opened(core: Transport, group: string) {
  return render(Routed, { core: connect(core), group });
}

/** EVCC's broker, signed in with both credentials. */
const BROKER: Connection = {
  id: 2,
  name: "EVCC",
  transport: "mqtt",
  host: "evcc.lan",
  port: 1883,
  topicRoot: "evcc",
  secrets: ["password", "username"],
};

test("an admin adds an MQTT connection and an EVCC device; its loadpoint shows on the dashboard", async () => {
  const core = new FakeCore();
  const settings = await opened(core, "connections");

  await settings.getByRole("button", { name: "Verbindung hinzufügen" }).click();
  await userEvent.fill(settings.getByRole("textbox", { name: "Name" }), "EVCC");
  await userEvent.click(settings.getByRole("combobox", { name: "Übertragung" }));
  await userEvent.click(page.getByRole("option", { name: "mqtt", exact: true }));
  await userEvent.fill(settings.getByRole("textbox", { name: "Host" }), "evcc.lan");
  await userEvent.fill(settings.getByRole("textbox", { name: "Topic-Wurzel" }), "evcc");
  await userEvent.fill(settings.getByRole("textbox", { name: "Benutzername" }), "sunreye");
  await userEvent.fill(settings.getByLabelText("Passwort", { exact: true }), "hunter2");
  await settings.getByRole("button", { name: "Verbindung hinzufügen" }).click();

  await expect.element(settings.getByRole("button", { name: /^EVCC/u })).toBeVisible();
  await settings.unmount();

  const devices = await opened(core, "devices");

  await devices.getByRole("button", { name: "Gerät hinzufügen" }).click();
  await devices.getByRole("button", { name: "Auf einer Verbindung hinzufügen" }).click();
  await userEvent.click(devices.getByRole("combobox", { name: "Verbindung" }));
  await userEvent.click(page.getByRole("option", { name: "EVCC · mqtt", exact: true }));
  await devices.getByRole("button", { name: "Profil", exact: true }).click();
  await userEvent.fill(page.getByRole("searchbox", { name: "Profil suchen" }), "evcc");
  await page.getByRole("button", { name: /^Loadpoint/u }).click();
  await expect.element(devices.getByRole("button", { name: /^Ladepunkt 1/u })).toBeVisible();
  await userEvent.fill(devices.getByRole("textbox", { name: "Name" }), "Wallbox");
  await devices.getByRole("button", { name: "Gerät hinzufügen" }).click();

  await expect.element(devices.getByRole("button", { name: /^Wallbox/u })).toBeVisible();
  expect(core.calls).toEqual([
    'POST /api/v1/connections {"name":"EVCC","transport":"mqtt","host":"evcc.lan","port":1883,"topicRoot":"evcc","secrets":{"username":"sunreye","password":"hunter2"}}',
    'POST /api/v1/devices {"connection":11,"name":"Wallbox","profile":"evcc","unit":1,"writes":false}',
  ]);
  await devices.unmount();

  // The core reads the loadpoint it was given.
  core.live = { "12": { "ev.charge.power": 3700, "ev.vehicle.soc": 64, "ev.limit.soc": 80 } };
  const dashboard = await render(Dashboard, { core: connect(core), layout: null, admin: true });

  await expect.element(dashboard.getByText("Wallbox")).toBeVisible();
  await expect.element(dashboard.getByText("Ziel 80 %")).toBeVisible();
});

test("secrets are never shown back, only set or not set; saving keeps them unless changed", async () => {
  const core = new FakeCore();

  core.connections.push({ ...BROKER, secrets: ["username"] });

  const screen = await opened(core, "connections");

  await screen.getByRole("button", { name: /^EVCC/u }).click();

  await expect.element(screen.getByText("Benutzername: gesetzt")).toBeVisible();
  await expect.element(screen.getByText("Passwort: nicht gesetzt")).toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "Benutzername" })).toHaveValue("");

  await userEvent.fill(screen.getByRole("textbox", { name: "Host" }), "evcc.home");
  await screen.getByRole("button", { name: "Speichern" }).click();
  await screen.getByRole("button", { name: /^EVCC/u }).click();
  await screen.getByRole("button", { name: "Benutzername löschen" }).click();
  await expect.element(screen.getByText("Benutzername: wird gelöscht")).toBeVisible();
  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.poll(() => core.connections[1]?.secrets).toEqual([]);
  expect(core.calls).toEqual([
    'PUT /api/v1/connections/2 {"name":"EVCC","transport":"mqtt","host":"evcc.home","port":1883,"topicRoot":"evcc"}',
    'PUT /api/v1/connections/2 {"name":"EVCC","transport":"mqtt","host":"evcc.home","port":1883,"topicRoot":"evcc","secrets":{"username":null}}',
  ]);
});

test("a connection a device uses is kept with the reason; an unused one is removed", async () => {
  const core = new FakeCore();

  core.connections.push(BROKER);

  const screen = await opened(core, "connections");

  await screen.getByRole("button", { name: /^Gateway/u }).click();
  await screen.getByRole("button", { name: "Verbindung entfernen" }).click();
  await screen.getByRole("button", { name: "Entfernen", exact: true }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Ein Gerät nutzt diese Verbindung noch.");

  await screen.getByRole("button", { name: "Verbindungen" }).click();
  await screen.getByRole("button", { name: /^EVCC/u }).click();
  await screen.getByRole("button", { name: "Verbindung entfernen" }).click();
  await screen.getByRole("button", { name: "Entfernen", exact: true }).click();

  await expect.element(screen.getByRole("button", { name: /^Gateway/u })).toBeVisible();
  expect(screen.getByRole("button", { name: /^EVCC/u }).query()).toBeNull();
});

test("a connection's level is a hash route: browser back steps out of it and forward into it again", async () => {
  const screen = await opened(new FakeCore(), "connections");
  const host = screen.getByRole("textbox", { name: "Host" });

  await screen.getByRole("button", { name: /^Gateway/u }).click();
  await expect.element(host).toBeVisible();
  expect(location.hash).toBe("#/settings?group=connections&level=1");

  history.back();

  await expect.element(screen.getByRole("button", { name: /^Gateway/u })).toBeVisible();
  expect(host.query()).toBeNull();

  history.forward();

  await expect.element(host).toBeVisible();
});

test("a Modbus connection's level edits its poll interval; a broker's has none", async () => {
  const core = new FakeCore();

  core.connections.push(BROKER);

  const screen = await opened(core, "connections");
  const interval = screen.getByRole("button", { name: /^Abfrageintervall \(s\)/u });

  await screen.getByRole("button", { name: /^EVCC/u }).click();
  await expect.element(screen.getByRole("textbox", { name: "Topic-Wurzel" })).toBeVisible();
  expect(interval.query()).toBeNull();

  await screen.getByRole("button", { name: "Verbindungen" }).click();
  await screen.getByRole("button", { name: /^Gateway/u }).click();
  await expect
    .element(screen.getByRole("button", { name: "Abfrageintervall (s) 5" }))
    .toBeVisible();

  await interval.click();
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await userEvent.fill(page.getByRole("textbox", { name: "Abfrageintervall (s) eingeben" }), "20");
  await userEvent.keyboard("{Enter}");
  await page.getByRole("button", { name: /^Übernehmen/u }).click();
  await expect
    .element(screen.getByRole("button", { name: "Abfrageintervall (s) 20" }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.poll(() => core.connections[0]?.pollSeconds).toBe(20);
  expect(core.calls).toEqual([
    'PUT /api/v1/connections/1 {"name":"Gateway","transport":"modbus-tcp","host":"192.168.1.30","port":502,"pollSeconds":20}',
  ]);
});
