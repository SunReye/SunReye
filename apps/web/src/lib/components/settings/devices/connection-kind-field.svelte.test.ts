import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: KindField } = await import("./connection-kind-field.svelte");

afterEach(() => get.mockReset());

async function served(integrations: boolean) {
  get.mockResolvedValue({ data: { integrations } });
  await coreCapabilities.load();
}

test("a core without integrations offers no MQTT broker to add", async () => {
  await served(false);
  render(KindField, { value: "modbus", locked: false });
  await expect.element(page.getByText(m.devices_kind_modbus())).toBeVisible();
  await expect.element(page.getByRole("combobox")).not.toBeInTheDocument();
  await expect.element(page.getByText(m.devices_kind_mqtt())).not.toBeInTheDocument();
});

test("an engine serving integrations offers both kinds", async () => {
  await served(true);
  render(KindField, { value: "modbus", locked: false });
  const kinds = page.getByRole("option");
  await expect.element(kinds.nth(1)).toHaveTextContent(m.devices_kind_mqtt());
  expect(kinds.elements().map((o) => o.textContent?.trim())).toEqual([
    m.devices_kind_modbus(),
    m.devices_kind_mqtt(),
  ]);
});

test("a saved connection states its kind and why it cannot change", async () => {
  await served(true);
  render(KindField, { value: "mqtt", locked: true });
  await expect.element(page.getByText(m.devices_kind_mqtt())).toBeVisible();
  await expect.element(page.getByText(m.devices_kind_locked())).toBeVisible();
  await expect.element(page.getByRole("combobox")).not.toBeInTheDocument();
});
