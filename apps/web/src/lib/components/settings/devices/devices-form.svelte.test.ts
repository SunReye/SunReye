import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

type Roster = components["schemas"]["DeviceRoster"];
type Device = components["schemas"]["DeviceView"];
type Connection = components["schemas"]["ConnectionView"];

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("svelte-sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The 4.0 build has no Elysia: any call to it is a dead request.
vi.mock("$lib/api", () => ({
  api: new Proxy({}, { get: () => expect.fail("the roster asked the Elysia API") }),
}));
const get = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, PATCH: patch, DELETE: del } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: DevicesForm } = await import("./devices-form.svelte");

/** What the core reports: no integrations, no per-device PV arrays or pack. */
const CORE = {
  history: true,
  statistics: true,
  controls: false,
  automations: false,
  restart: false,
  profileSources: true,
  integrations: false,
  pvAndBattery: false,
  pricesAndCosts: false,
  evccCommands: false,
  customCharts: false,
};

const connection = (id: number, name: string, port: number): Connection => ({
  id,
  name,
  kind: "modbus",
  params: { host: "127.0.0.1", port, transport: "tcp", timeoutMs: 2000, pollIntervalMs: 1000 },
});

const INVERTER = connection(1, "Inverter", 502);
const GARAGE = connection(2, "Garage", 1502);

/** A device as the core answers it: the stores it has no table for are empty or null. */
const device = (
  id: number,
  name: string,
  on: Connection,
  retiredAt: string | null = null,
): Device => ({
  id,
  slug: String(id),
  name,
  profileId: "deye-sg05lp3",
  role: id === 1 ? "inverter" : "meter",
  unitId: 1,
  connectionId: on.id,
  params: {},
  arrays: [],
  tempCoefficient: null,
  systemLoss: null,
  retiredAt,
  connection: on,
  battery: null,
  profileName: "SG05LP3",
  profileKnown: true,
  kind: "modbus",
  state: retiredAt ? "retired" : "polling",
  integration: null,
});

let roster: Roster;

beforeEach(async () => {
  roster = {
    devices: [device(1, "Hybrid", INVERTER), device(2, "Grid meter", GARAGE)],
    connections: [INVERTER, GARAGE],
  };
  get.mockImplementation(async (path: string) => {
    if (path === "/api/capabilities") return { data: CORE };
    if (path === "/api/devices") return { data: roster };
    return { data: [] };
  });
  await coreCapabilities.load();
});
afterEach(() => {
  for (const fn of [get, patch, del]) fn.mockReset();
});

const moreFor = (name: string) =>
  page.getByRole("button", { name: m.devices_more_actions({ name }) });

test("a two-device roster lists both devices under their connections, read from the core", async () => {
  render(DevicesForm);
  await expect.element(page.getByText("Hybrid", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Grid meter", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Inverter" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Garage" })).toBeVisible();
  expect(get.mock.calls.map(([path]) => path)).toEqual(["/api/capabilities", "/api/devices"]);
});

test("a second polled device is retired through the core, the one the inverter settings edit is not", async () => {
  patch.mockResolvedValue({ data: { ...device(2, "Grid meter", GARAGE, "2026-11-03T07:00:00Z") } });
  render(DevicesForm);
  await moreFor("Hybrid").click();
  await expect
    .element(page.getByRole("menuitem", { name: /Retire/ }))
    .toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{Escape}");
  await moreFor("Grid meter").click();
  await page.getByRole("menuitem", { name: m.devices_action_retire() }).click();
  await page.getByRole("button", { name: m.devices_action_retire() }).click();
  await vi.waitFor(() =>
    expect(patch).toHaveBeenCalledWith("/api/devices/{id}", {
      params: { path: { id: 2 } },
      body: { retired: true },
    }),
  );
});

test("a retired device is listed folded away and restored through the core", async () => {
  roster.devices.push(device(3, "Old meter", GARAGE, "2026-10-01T00:00:00Z"));
  patch.mockResolvedValue({ data: device(3, "Old meter", GARAGE) });
  render(DevicesForm);
  await page.getByRole("button", { name: m.devices_retired_count({ count: 1 }) }).click();
  await expect.element(page.getByText(m.devices_badge_retired())).toBeVisible();
  await page.getByRole("button", { name: m.devices_action_restore() }).click();
  await vi.waitFor(() =>
    expect(patch).toHaveBeenCalledWith("/api/devices/{id}", {
      params: { path: { id: 3 } },
      body: { retired: false },
    }),
  );
});

test("the core's refusal to delete a device with history turns the dialog into the offer to retire", async () => {
  del.mockResolvedValue({
    error: {
      error: "this device has recorded history; retire it instead to keep that history",
      field: "history",
    },
  });
  render(DevicesForm);
  await moreFor("Grid meter").click();
  await page.getByRole("menuitem", { name: m.devices_action_delete() }).click();
  await page.getByRole("button", { name: m.devices_action_delete() }).click();
  await expect
    .element(page.getByText(m.devices_delete_history_title({ name: "Grid meter" })))
    .toBeVisible();
  await expect.element(page.getByText(m.devices_delete_history_body())).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: m.devices_retire_instead() }))
    .toBeVisible();
  expect(del).toHaveBeenCalledWith("/api/devices/{id}", { params: { path: { id: 2 } } });
});
