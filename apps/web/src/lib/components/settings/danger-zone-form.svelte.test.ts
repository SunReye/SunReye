import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
// The 4.0 build has no Elysia: any call to it is a dead request.
vi.mock("$lib/api", () => ({
  api: new Proxy({}, { get: () => expect.fail("the danger zone asked the Elysia API") }),
}));
vi.mock("svelte-sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: DangerZoneForm } = await import("./danger-zone-form.svelte");

type Capabilities = components["schemas"]["Capabilities"];

const SERVED: Capabilities = {
  history: true,
  statistics: true,
  controls: false,
  automations: false,
  restart: false,
  profileSources: true,
  integrations: false,
  pvAndBattery: false,
  pricesAndCosts: false,
  statisticsHeatmap: false,
  evccCommands: false,
  customCharts: false,
  logging: false,
  dataReset: true,
};

async function offering(capabilities: Capabilities) {
  get.mockResolvedValue({ data: capabilities });
  await coreCapabilities.load();
}

beforeEach(() => offering(SERVED));
afterEach(() => get.mockReset());

test("a core that serves the danger zone shows it", async () => {
  render(DangerZoneForm);
  await expect.element(page.getByRole("heading", { name: m.danger_zone_title() })).toBeVisible();
  await expect.element(page.getByText(m.danger_export_title())).toBeVisible();
});

test("the zone offers no data wipe: the core serves no route to perform it", async () => {
  render(DangerZoneForm);
  await expect.element(page.getByRole("heading", { name: m.danger_zone_title() })).toBeVisible();
  expect(page.getByRole("button", { name: m.danger_reset_button() }).query()).toBeNull();
});

test("a core that does not serve the danger zone renders nothing", async () => {
  await offering({ ...SERVED, dataReset: false });
  render(DangerZoneForm);
  expect(page.getByRole("heading", { name: m.danger_zone_title() }).query()).toBeNull();
  expect(page.getByText(m.danger_export_title()).query()).toBeNull();
});
