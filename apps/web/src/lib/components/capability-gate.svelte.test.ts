import { afterEach, describe, expect, test, vi } from "vitest";
import { createRawSnippet } from "svelte";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { coreCapabilities } from "$lib/capabilities.svelte";
import CapabilityGate from "./capability-gate.svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

/** What a core that serves no optional area reports; each test turns on what it serves. */
const NONE = {
  history: false,
  statistics: false,
  controls: false,
  automations: false,
  restart: false,
  profileSources: false,
  integrations: false,
  pvAndBattery: false,
  pricesAndCosts: false,
  statisticsHeatmap: false,
  evccCommands: false,
  customCharts: false,
  logging: false,
  dataReset: false,
};

const content = createRawSnippet(() => ({ render: () => "<p>the panel</p>" }));

async function serving(served: Partial<typeof NONE>) {
  get.mockResolvedValue({ data: { ...NONE, ...served } });
  await coreCapabilities.load();
}

afterEach(async () => {
  get.mockRejectedValue(new Error("no core"));
  await coreCapabilities.load();
  get.mockReset();
});

describe("a panel behind a capability", () => {
  test("renders when the core serves the capability", async () => {
    await serving({ automations: true });
    render(CapabilityGate, { name: "automations", children: content });
    await expect.element(page.getByText("the panel")).toBeVisible();
  });

  test("renders nothing when the core reports the capability absent", async () => {
    await serving({ pricesAndCosts: true });
    const view = await render(CapabilityGate, { name: "automations", children: content });
    expect(view.container.textContent?.trim()).toBe("");
    await expect.element(page.getByText("the panel")).not.toBeInTheDocument();
  });

  test("renders while the core has not answered, like every other area", async () => {
    get.mockRejectedValue(new Error("no core"));
    await coreCapabilities.load();
    render(CapabilityGate, { name: "automations", children: content });
    await expect.element(page.getByText("the panel")).toBeVisible();
  });
});
