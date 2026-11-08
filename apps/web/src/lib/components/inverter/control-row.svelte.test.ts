import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { ManifestMetric } from "$lib/inverter/types";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
const postSetting = vi.hoisted(() => vi.fn());
vi.mock("$lib/engine-only", () => ({ postSetting }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: ControlRow } = await import("./control-row.svelte");

const metric = {
  key: "settings.grid_charge",
  label: "Grid charge",
  unit: "",
  writable: true,
  enumLabels: { 0: "Off", 1: "On" },
} as unknown as ManifestMetric;

afterEach(() => {
  get.mockReset();
  postSetting.mockReset();
});

test("shows the control while the core serves controls", async () => {
  get.mockResolvedValue({ data: { controls: true } });
  await coreCapabilities.load();
  render(ControlRow, { metric });
  await expect.element(page.getByText("Grid charge")).toBeVisible();
  await expect.element(page.getByRole("switch")).toBeVisible();
});

test("renders nothing when the core reports controls absent", async () => {
  get.mockResolvedValue({ data: { controls: false } });
  await coreCapabilities.load();
  render(ControlRow, { metric });
  await expect.element(page.getByText("Grid charge")).not.toBeInTheDocument();
  await expect.element(page.getByRole("switch")).not.toBeInTheDocument();
  expect(postSetting).not.toHaveBeenCalled();
});

test("a refused write puts the control back on the live value and frees it", async () => {
  get.mockResolvedValue({ data: { controls: true } });
  postSetting.mockResolvedValue(false);
  await coreCapabilities.load();
  render(ControlRow, { metric });
  await page.getByRole("switch").click();
  expect(postSetting).toHaveBeenCalledWith("settings.grid_charge", 1);
  await expect.element(page.getByText("Off")).toBeVisible();
  await expect.element(page.getByRole("switch")).toBeEnabled();
});
