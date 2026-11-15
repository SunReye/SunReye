import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import { FakeCore } from "./devices.harness.ts";
import Routed from "./routed.harness.svelte";

/** A phone; the value editor and levels land at once. */
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

/** Types `value` into a number row's value editor and applies it. */
async function enter(row: string, value: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${row} `, "u") }).click();
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await userEvent.fill(page.getByRole("textbox", { name: `${row} eingeben` }), value);
  await userEvent.keyboard("{Enter}");
  await page.getByRole("button", { name: /^Übernehmen/u }).click();
}

test("the admin adds a scanned Modbus device after setup, renames it and removes it", async () => {
  const core = new FakeCore();
  const screen = await opened(core, "devices");

  await screen.getByRole("button", { name: "Gerät hinzufügen" }).click();
  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();
  await userEvent.fill(screen.getByLabelText("Name von SUN-5K-SG05LP3-EU-SM2"), "Speicher");
  await screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }).click();

  await expect.element(screen.getByRole("button", { name: /^Speicher/u })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Messpunkte prüfen" })).toBeVisible();

  await screen.getByRole("button", { name: /^Speicher/u }).click();
  await expect.element(screen.getByText("Das Profil bleibt fest", { exact: false })).toBeVisible();
  await userEvent.fill(screen.getByRole("textbox", { name: "Name" }), "Speicher Keller");
  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.element(screen.getByRole("button", { name: /^Speicher Keller/u })).toBeVisible();

  await screen.getByRole("button", { name: /^Speicher Keller/u }).click();
  await screen.getByRole("button", { name: "Gerät entfernen" }).click();
  await expect.element(screen.getByText("Sein Verlauf bleibt erhalten.")).toBeVisible();
  await screen.getByRole("button", { name: "Entfernen", exact: true }).click();

  await expect.element(screen.getByRole("button", { name: /^Wechselrichter/u })).toBeVisible();
  expect(screen.getByRole("button", { name: /^Speicher/u }).query()).toBeNull();
  expect(core.calls).toEqual([
    "POST /api/v1/scan {}",
    'POST /api/v1/connections {"name":"192.168.1.40","host":"192.168.1.40","port":502,"transport":"modbus-tcp"}',
    'POST /api/v1/devices {"connection":11,"name":"Speicher","profile":"deye-sg05lp3","variant":"5k","unit":1}',
    'PUT /api/v1/devices/12 {"connection":11,"name":"Speicher Keller","profile":"deye-sg05lp3","variant":"5k","unit":1,"writes":false}',
    "DELETE /api/v1/devices/12",
  ]);
});

test("a device moves to another unit id on its connection", async () => {
  const core = new FakeCore();
  const screen = await opened(core, "devices");

  await screen.getByRole("button", { name: /^Wechselrichter/u }).click();
  await enter("Adresse", "2");
  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.poll(() => core.devices[0]?.unit).toBe(2);
});

test("a device added on an endpoint a connection already reaches reuses that connection", async () => {
  const core = new FakeCore();

  core.connections[0] = { ...core.connections[0]!, host: "192.168.1.40" };
  core.devices[0] = { ...core.devices[0]!, unit: 2 };

  const screen = await opened(core, "devices");

  await screen.getByRole("button", { name: "Gerät hinzufügen" }).click();
  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();
  await screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }).click();

  await expect.poll(() => core.devices.length).toBe(2);
  expect(core.calls.filter((call) => call.includes("/connections"))).toEqual([]);
});

test("a scan leaves out a device the core already reads", async () => {
  const core = new FakeCore();

  core.connections[0] = { ...core.connections[0]!, host: "192.168.1.40" };

  const screen = await opened(core, "devices");

  await screen.getByRole("button", { name: "Gerät hinzufügen" }).click();
  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();

  await expect.element(screen.getByText("1 gefundene Geräte liest SunReye schon.")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }))
    .toBeDisabled();
  expect(screen.getByLabelText("Name von SUN-5K-SG05LP3-EU-SM2").query()).toBeNull();
});

test("a device's level is a hash route: browser back steps out of it and forward into it again", async () => {
  const screen = await opened(new FakeCore(), "devices");
  const name = screen.getByRole("textbox", { name: "Name" });

  await screen.getByRole("button", { name: /^Wechselrichter/u }).click();
  await expect.element(name).toBeVisible();
  expect(location.hash).toBe("#/settings?group=devices&level=3");

  history.back();

  await expect.element(screen.getByRole("button", { name: "Gerät hinzufügen" })).toBeVisible();
  expect(name.query()).toBeNull();
  expect(location.hash).toBe("#/settings?group=devices");

  history.forward();

  await expect.element(name).toBeVisible();

  // The level's own back button is the browser's.
  await screen.getByRole("button", { name: "Geräte" }).click();

  await expect.element(screen.getByRole("button", { name: "Gerät hinzufügen" })).toBeVisible();
  expect(location.hash).toBe("#/settings?group=devices");
});

test("adding a device is a level of its own in the history", async () => {
  const screen = await opened(new FakeCore(), "devices");

  await screen.getByRole("button", { name: "Gerät hinzufügen" }).click();
  await expect.element(screen.getByRole("button", { name: "Netzwerk durchsuchen" })).toBeVisible();
  expect(location.hash).toBe("#/settings?group=devices&level=add");

  history.back();

  await expect.element(screen.getByRole("button", { name: /^Wechselrichter/u })).toBeVisible();
});
