import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { readable } from "svelte/store";
import { coreCapabilities } from "$lib/capabilities.svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get, PUT: vi.fn() } }));
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: { user: { admin: true } }, isPending: false }),
}));

/** What a core reports; `pricesAndCosts` is the one this panel reads. */
const caps = (pricesAndCosts: boolean) => ({
  history: true,
  statistics: true,
  controls: true,
  automations: true,
  restart: true,
  profileSources: true,
  integrations: true,
  pvAndBattery: true,
  pricesAndCosts,
  statisticsHeatmap: true,
  evccCommands: true,
  customCharts: true,
  logging: true,
  dataReset: true,
});

/** The core answers capabilities and nothing else, so a form that loads stays on its loading state. */
const answer = (pricesAndCosts: boolean) => async (path: string) =>
  path === "/api/capabilities" ? { data: caps(pricesAndCosts) } : { data: undefined };

/** A 3.x engine: no capabilities endpoint. Anything else a mounted form asks for is empty. */
const noCore = async (path: string) => {
  if (path === "/api/capabilities") throw new Error("no core");
  return { data: undefined };
};

const { default: Panel } = await import("./+page.svelte");

afterEach(async () => {
  get.mockImplementation(noCore);
  await coreCapabilities.load();
  get.mockReset();
});

describe("the tariff panel", () => {
  test("renders when the core serves prices and costs", async () => {
    get.mockImplementation(answer(true));
    await coreCapabilities.load();
    const view = await render(Panel);
    await vi.waitFor(() => expect(view.container.textContent?.trim()).not.toBe(""));
  });

  test("renders nothing when the core does not serve prices and costs", async () => {
    get.mockImplementation(answer(false));
    await coreCapabilities.load();
    const view = await render(Panel);
    expect(view.container.textContent?.trim()).toBe("");
    expect(get).not.toHaveBeenCalledWith("/api/settings/tariff");
  });

  test("renders while the core has not answered (3.x engine)", async () => {
    get.mockImplementation(noCore);
    await coreCapabilities.load();
    const view = await render(Panel);
    await vi.waitFor(() => expect(view.container.textContent?.trim()).not.toBe(""));
  });
});
