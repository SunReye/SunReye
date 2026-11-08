import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { readable } from "svelte/store";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get, PUT: put } }));
const admin = { id: 1, name: "Ada", email: "ada@example.com", admin: true };
let signedIn: { user: typeof admin } = { user: admin };
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: signedIn, isPending: false }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast }));

const { default: SpotPriceForm } = await import("./spot-price-form.svelte");

const STORED = { enabled: true, provider: "energy-charts", zone: "DE-LU" };
const PROVIDERS = [
  { id: "energy-charts", zones: ["AT", "DE-LU"], attribution: "Energy-Charts credit" },
  { id: "awattar", zones: ["DE-LU"], attribution: "aWATTar credit" },
];

beforeEach(() => {
  signedIn = { user: admin };
  get.mockImplementation(async (path: string) => {
    if (path === "/api/settings/spot-prices") return { data: STORED };
    if (path === "/api/prices/providers") return { data: PROVIDERS };
    return { data: undefined };
  });
  put.mockImplementation(async (_path: string, { body }: { body: object }) => ({ data: body }));
});
afterEach(() => {
  for (const fn of [get, put, toast.success, toast.error]) fn.mockReset();
});

const save = () => page.getByRole("button", { name: m.action_save(), exact: true });

test("shows the stored source and the selected provider's attribution from the core", async () => {
  render(SpotPriceForm);
  await expect.element(page.getByText("Energy-Charts credit")).toBeVisible();
  await expect.element(page.getByLabelText(m.prices_settings_enable())).toBeChecked();
  expect(get).toHaveBeenCalledWith("/api/settings/spot-prices");
  expect(get).toHaveBeenCalledWith("/api/prices/providers");
});

test("saving PUTs the config with the resolved zone, and reports it", async () => {
  render(SpotPriceForm);
  await expect.element(page.getByText("Energy-Charts credit")).toBeVisible();
  await save().click();
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.prices_settings_saved()));
  expect(put).toHaveBeenCalledWith("/api/settings/spot-prices", { body: STORED });
});

test("a refused save reports the core's reason", async () => {
  put.mockResolvedValue({ error: { error: "Zone not served" } });
  render(SpotPriceForm);
  await expect.element(page.getByText("Energy-Charts credit")).toBeVisible();
  await save().click();
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Zone not served"));
  expect(toast.success).not.toHaveBeenCalled();
});

test("a viewer who is not an admin cannot save", async () => {
  signedIn = { user: { ...admin, admin: false } };
  render(SpotPriceForm);
  await expect.element(page.getByText("Energy-Charts credit")).toBeVisible();
  await expect.element(save()).toBeDisabled();
});
