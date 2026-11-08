import { afterEach, describe, expect, test, vi } from "vitest";
import { createRawSnippet } from "svelte";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { coreCapabilities } from "$lib/capabilities.svelte";
import AutomationsLayout from "./+layout.svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

/** What a core reports; `automations` is the one the layout reads. */
const caps = (automations: boolean) => ({
  history: true,
  statistics: true,
  controls: true,
  automations,
  restart: true,
  profileSources: true,
  integrations: true,
  pvAndBattery: true,
  pricesAndCosts: true,
  statisticsHeatmap: true,
  evccCommands: true,
  customCharts: true,
  logging: true,
  dataReset: true,
});

const page_ = createRawSnippet(() => ({ render: () => "<p>automations page</p>" }));

afterEach(async () => {
  get.mockRejectedValue(new Error("no core"));
  await coreCapabilities.load();
  get.mockReset();
});

describe("the automations route area", () => {
  test("renders its pages when the core serves automations", async () => {
    get.mockResolvedValue({ data: caps(true) });
    await coreCapabilities.load();
    render(AutomationsLayout, { children: page_ });
    await expect.element(page.getByText("automations page")).toBeVisible();
  });

  test("renders nothing when the core does not serve automations", async () => {
    get.mockResolvedValue({ data: caps(false) });
    await coreCapabilities.load();
    const view = await render(AutomationsLayout, { children: page_ });
    expect(view.container.textContent?.trim()).toBe("");
    await expect.element(page.getByText("automations page")).not.toBeInTheDocument();
  });

  test("renders its pages while the core has not answered (3.x engine)", async () => {
    get.mockRejectedValue(new Error("no core"));
    await coreCapabilities.load();
    render(AutomationsLayout, { children: page_ });
    await expect.element(page.getByText("automations page")).toBeVisible();
  });
});
