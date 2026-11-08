import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
// The panel leases the `logs` topic on the app's one socket; none exists here.
vi.mock("$lib/ws/bus.svelte", () => ({
  bus: { connected: false, subscribe: () => () => {} },
}));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: LogsViewer } = await import("./logs-viewer.svelte");

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
  logging: true,
  dataReset: false,
};

async function offering(capabilities: Capabilities) {
  get.mockResolvedValue({ data: capabilities });
  await coreCapabilities.load();
}

beforeEach(() => offering(SERVED));
afterEach(() => get.mockReset());

test("a core that serves logging shows the log panel", async () => {
  render(LogsViewer);
  await expect.element(page.getByText(m.logs_desc())).toBeVisible();
});

test("the panel has no server-level control: the core serves no route to set it", async () => {
  render(LogsViewer);
  await expect.element(page.getByText(m.logs_desc())).toBeVisible();
  expect(page.getByText(m.logs_server_level()).query()).toBeNull();
});

test("a core that does not serve logging renders nothing", async () => {
  await offering({ ...SERVED, logging: false });
  render(LogsViewer);
  expect(page.getByText(m.logs_desc()).query()).toBeNull();
});
