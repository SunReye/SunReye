import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { ManifestMetric } from "$lib/inverter/types";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
const fetchCostToday = vi.hoisted(() => vi.fn());
vi.mock("$lib/engine-only", () => ({ fetchCostToday }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { inverter } = await import("$lib/inverter/store.svelte");
const { default: DailyEnergy } = await import("./daily-energy.svelte");

const cost = {
  currency: "EUR",
  importCost: 1.25,
  exportEarnings: 0.5,
  solarSavings: 2,
  selfSufficiency: 0.5,
  selfConsumption: 0.25,
};

function mapRole() {
  const metric = {
    key: "grid.imported",
    label: "Imported",
    unit: "kWh",
  } as unknown as ManifestMetric;
  vi.spyOn(inverter, "byRole").mockImplementation((role) =>
    role === "grid.energy.imported.today" ? metric : undefined,
  );
}

afterEach(() => {
  get.mockReset();
  fetchCostToday.mockReset();
  vi.restoreAllMocks();
});

test("reads and shows today's cost while the core serves prices and costs", async () => {
  get.mockResolvedValue({ data: { pricesAndCosts: true } });
  fetchCostToday.mockResolvedValue(cost);
  await coreCapabilities.load();
  mapRole();
  render(DailyEnergy);
  await expect.element(page.getByText(m.energy_spent())).toBeVisible();
  expect(fetchCostToday).toHaveBeenCalled();
});

test("makes no cost read and shows no money row when the core reports prices and costs absent", async () => {
  get.mockResolvedValue({ data: { pricesAndCosts: false } });
  await coreCapabilities.load();
  mapRole();
  render(DailyEnergy);
  await expect.element(page.getByText(m.energy_purchase())).toBeVisible();
  await expect.element(page.getByText(m.energy_spent())).not.toBeInTheDocument();
  expect(fetchCostToday).not.toHaveBeenCalled();
});
