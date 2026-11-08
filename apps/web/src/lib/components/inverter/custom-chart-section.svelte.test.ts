import { readable } from "svelte/store";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
const listCustomCharts = vi.hoisted(() => vi.fn());
vi.mock("$lib/engine-only", async (original) => ({
  ...(await original<typeof import("$lib/engine-only")>()),
  listCustomCharts,
}));
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: { user: { admin: true } }, isPending: false }),
}));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: CustomChartSection } = await import("./custom-chart-section.svelte");

const range = { preset: "today" } as never;

afterEach(() => {
  get.mockReset();
  listCustomCharts.mockReset();
});

test("offers the custom charts while the core serves them", async () => {
  get.mockResolvedValue({ data: { customCharts: true } });
  listCustomCharts.mockResolvedValue([]);
  await coreCapabilities.load();
  render(CustomChartSection, { range });
  await expect.element(page.getByText(m.chart_custom_charts())).toBeVisible();
});

test("renders nothing and reads nothing when the core reports custom charts absent", async () => {
  get.mockResolvedValue({ data: { customCharts: false } });
  await coreCapabilities.load();
  render(CustomChartSection, { range });
  await expect.element(page.getByText(m.chart_custom_charts())).not.toBeInTheDocument();
  expect(listCustomCharts).not.toHaveBeenCalled();
});
