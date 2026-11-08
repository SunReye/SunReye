import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { coreCapabilities } from "$lib/capabilities.svelte";
import Stub from "./section-body.fixture.svelte";
import Fixture from "./section-list.fixture.svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("$lib/api", () => ({ api: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
vi.mock("./section-body.svelte", () => ({ default: Stub }));

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
};

async function mountWith(served: Partial<typeof NONE>) {
  get.mockResolvedValue({ data: { ...NONE, ...served } });
  await coreCapabilities.load();
  render(Fixture);
}

afterEach(() => get.mockReset());

describe("the statistics sections the core serves", () => {
  test("a core without prices and costs shows only the energy section", async () => {
    await mountWith({ statistics: true });
    await expect.element(page.getByText("body:energy")).toBeVisible();
    for (const id of ["cost", "prices", "records", "amortisation"]) {
      await expect.element(page.getByText(`body:${id}`)).not.toBeInTheDocument();
    }
  });

  test("a core with prices and costs shows all five", async () => {
    await mountWith({ statistics: true, pricesAndCosts: true });
    for (const id of ["cost", "energy", "prices", "records", "amortisation"]) {
      await expect.element(page.getByText(`body:${id}`)).toBeVisible();
    }
  });
});
