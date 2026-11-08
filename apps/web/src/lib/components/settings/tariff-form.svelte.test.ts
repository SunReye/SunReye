import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get, PUT: put } }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast }));

const { default: TariffForm } = await import("./tariff-form.svelte");

const SPOT_IMPORT = {
  supplierMarkupPerKwh: 0.01,
  gridFeesPerKwh: 0.08,
  leviesPerKwh: 0.05,
  vatPercent: 19,
  clampToZero: false,
};
const STORED_TARIFF = {
  currency: "EUR",
  standingChargeMonthly: 12.5,
  import: {
    mode: "static",
    defaultPricePerKwh: 0.31,
    bands: [
      { name: "Night", pricePerKwh: 0.2, startHour: 22, endHour: 6 },
      { name: "Peak", pricePerKwh: 0.4, startHour: 8, endHour: 20, days: [1, 2, 3, 4, 5] },
    ],
    spot: SPOT_IMPORT,
  },
  export: {
    mode: "static",
    feedInPerKwh: 0.082,
    spot: { marketingModel: "none", managementFeePerKwh: 0 },
  },
};
const STORED_INVESTMENT = { totalCost: 14800, commissionedOn: "2024-05-17" };

beforeEach(() => {
  get.mockImplementation(async (path: string) => {
    if (path === "/api/settings/tariff") return { data: STORED_TARIFF };
    if (path === "/api/settings/investment") return { data: STORED_INVESTMENT };
    return { data: undefined };
  });
  put.mockImplementation(async (_path: string, { body }: { body: object }) => ({ data: body }));
});
afterEach(() => {
  for (const fn of [get, put, toast.success, toast.error]) fn.mockReset();
});

const save = () => page.getByRole("button", { name: m.tariff_save(), exact: true });

test("shows the stored tariff and investment from the core", async () => {
  render(TariffForm);
  await expect.element(page.getByLabelText(m.tariff_currency())).toHaveValue("EUR");
  await expect.element(page.getByLabelText(m.tariff_standing_charge())).toHaveValue(12.5);
  await expect.element(page.getByLabelText(m.tariff_feed_in())).toHaveValue(0.082);
  await expect.element(page.getByLabelText(m.tariff_default_price())).toHaveValue(0.31);
  await expect.element(page.getByLabelText(m.tariff_total_cost())).toHaveValue(14800);
  await expect.element(page.getByLabelText(m.tariff_commissioned_on())).toHaveValue("2024-05-17");
  expect(get).toHaveBeenCalledWith("/api/settings/tariff");
  expect(get).toHaveBeenCalledWith("/api/settings/investment");
});

test("saving PUTs the whole tariff and the investment, a band on every day sending no days", async () => {
  render(TariffForm);
  const feedIn = page.getByLabelText(m.tariff_feed_in());
  await expect.element(feedIn).toHaveValue(0.082);
  await feedIn.fill("0.1");
  await save().click();
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.tariff_toast_saved()));
  expect(put).toHaveBeenCalledWith("/api/settings/tariff", {
    body: {
      ...STORED_TARIFF,
      export: { ...STORED_TARIFF.export, feedInPerKwh: 0.1 },
    },
  });
  expect(put).toHaveBeenCalledWith("/api/settings/investment", { body: STORED_INVESTMENT });
});

test("a refused tariff save is reported, and the success toast stays away", async () => {
  put.mockResolvedValue({ error: { error: "Admin only" } });
  render(TariffForm);
  await expect.element(page.getByLabelText(m.tariff_currency())).toHaveValue("EUR");
  await save().click();
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.tariff_toast_error()));
  expect(toast.success).not.toHaveBeenCalled();
});

test("a tariff that could not be read offers nothing to save", async () => {
  get.mockImplementation(async (path: string) =>
    path === "/api/settings/investment" ? { data: STORED_INVESTMENT } : { error: { error: "x" } },
  );
  render(TariffForm);
  await expect.element(page.getByText(m.tariff_loading())).toBeVisible();
  await expect.element(save()).not.toBeInTheDocument();
});
