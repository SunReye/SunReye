import { readable } from "svelte/store";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: { user: { admin: true } }, isPending: false }),
}));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: DraftChartFooter } = await import("./draft-chart-footer.svelte");

afterEach(() => get.mockReset());

test("an admin can save the draft as a custom chart while the core serves custom charts", async () => {
  get.mockResolvedValue({ data: { customCharts: true } });
  await coreCapabilities.load();
  render(DraftChartFooter, { metrics: ["battery.soc"], onClear: () => {} });
  await expect.element(page.getByRole("button", { name: "Clear preview" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Save as chart" })).toBeVisible();
});

test("the save control is hidden when the core reports custom charts absent", async () => {
  get.mockResolvedValue({ data: { customCharts: false } });
  await coreCapabilities.load();
  render(DraftChartFooter, { metrics: ["battery.soc"], onClear: () => {} });
  await expect.element(page.getByRole("button", { name: "Clear preview" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Save as chart" })).not.toBeInTheDocument();
});
