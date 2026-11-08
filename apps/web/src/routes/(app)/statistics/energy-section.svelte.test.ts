import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { coreCapabilities } from "$lib/capabilities.svelte";
import { inverter } from "$lib/inverter/store.svelte";
import Fixture from "./energy-section.fixture.svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const NONE = {
  history: false,
  statistics: true,
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

async function mountWith(served: Partial<typeof NONE>) {
  // The plant has a battery either way: the core's answer is what decides.
  inverter.manifest = { capabilities: { battery: true }, metrics: [] } as never;
  get.mockResolvedValue({ data: { ...NONE, ...served } });
  await coreCapabilities.load();
  render(Fixture);
}

afterEach(() => {
  get.mockReset();
  inverter.manifest = null;
});

describe("the energy section's panels beyond the series", () => {
  test("the heatmap stays away from a core that does not serve it", async () => {
    await mountWith({});
    await expect
      .element(page.getByText("Average per hour, folded onto one week"))
      .not.toBeInTheDocument();
  });

  test("the heatmap shows once the core serves it", async () => {
    await mountWith({ statisticsHeatmap: true });
    await expect.element(page.getByText("Average per hour, folded onto one week")).toBeVisible();
  });

  test("the battery capacity trend stays away from a core without PV and battery", async () => {
    await mountWith({});
    await expect.element(page.getByText("Battery capacity over time")).not.toBeInTheDocument();
  });

  test("the battery capacity trend shows once the core serves it", async () => {
    await mountWith({ pvAndBattery: true });
    await expect.element(page.getByText("Battery capacity over time")).toBeVisible();
  });
});
