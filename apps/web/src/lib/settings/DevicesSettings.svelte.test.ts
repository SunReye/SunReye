import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import { FakeCore } from "./devices.harness.ts";
import SettingsScreen from "./SettingsScreen.svelte";

/** A phone; the value editor and levels land at once. */
beforeEach(async () => {
  await page.viewport(390, 800);
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** Settings › `group`, as the admin. */
function opened(core: Transport, group: string) {
  return render(SettingsScreen, {
    core: connect(core),
    admin: true,
    open: group,
    onnavigate: () => null,
  });
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
  await userEvent.fill(screen.getByLabelText("Name von deye-sg05lp3"), "Speicher");
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
    'POST /api/v1/devices {"connection":11,"name":"Speicher","profile":"deye-sg05lp3","unit":1}',
    'PUT /api/v1/devices/12 {"connection":11,"name":"Speicher Keller","profile":"deye-sg05lp3","unit":1,"writes":false}',
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
  expect(screen.getByLabelText("Name von deye-sg05lp3").query()).toBeNull();
});
