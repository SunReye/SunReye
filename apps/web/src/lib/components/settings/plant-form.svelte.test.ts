import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { readable } from "svelte/store";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
// The form is on the core client: an Eden call would hit this and throw.
vi.mock("$lib/api", () => ({ api: {} }));
const get = vi.fn();
const put = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, PUT: put } }));
const admin = { id: 1, name: "Ada", email: "ada@example.com", admin: true };
let signedIn: { user: typeof admin } = { user: admin };
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: signedIn, isPending: false }),
}));
vi.mock("$lib/live/plant.svelte", () => ({
  livePlant: { lease: () => () => {}, read: () => ({ value: undefined }) },
}));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));

const { default: PlantForm } = await import("./plant-form.svelte");

type WeatherConfig = components["schemas"]["WeatherConfig"];

const STORED = {
  enabled: false,
  latitude: null,
  longitude: null,
  label: "",
  forecast: {
    enabled: false,
    provider: "open-meteo",
    arrays: [
      { kwp: 5, tilt: 30, azimuth: 0 },
      { kwp: 3.4, tilt: 20, azimuth: 90 },
    ],
    battery: null,
    correction: { enabled: false },
    houseLoadW: 400,
    maxOutputW: 6000,
    smartMeterSince: "2024-03-01",
    systemLoss: 14,
    tempCoefficient: -0.35,
  },
} as unknown as WeatherConfig;

beforeEach(() => {
  signedIn = { user: admin };
  get.mockResolvedValue({ data: STORED });
  put.mockResolvedValue({ data: STORED });
});
afterEach(() => {
  for (const fn of [get, put, toast.success, toast.error]) fn.mockReset();
});

const save = () => page.getByRole("button", { name: m.action_save(), exact: true });
const maxOutput = () => page.getByLabelText(m.weather_forecast_max_output());

test("shows the plant's stored site facts in kW from the core", async () => {
  render(PlantForm);
  await expect.element(maxOutput()).toHaveValue("6");
  expect(get).toHaveBeenCalledWith("/api/settings/weather");
});

test("the export-cap helper is sized from the sum of every inverter's arrays", async () => {
  render(PlantForm);
  // 5 + 3.4 kWp installed: 100 % of it is 8.4 kW.
  await page.getByRole("button", { name: "100 %" }).click();
  await expect.element(maxOutput()).toHaveValue("8.4");
});

test("saving writes only the site facts, in watts, and reports it", async () => {
  render(PlantForm);
  await expect.element(maxOutput()).toHaveValue("6");
  await maxOutput().fill("4.5");
  await save().click();
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.plant_toast_saved()));
  expect(put).toHaveBeenCalledWith("/api/settings/weather", {
    body: { forecast: { maxOutputW: 4500, houseLoadW: 400, smartMeterSince: "2024-03-01" } },
  });
});

test("a value that does not parse is refused before anything is sent", async () => {
  render(PlantForm);
  await expect.element(maxOutput()).toHaveValue("6");
  await maxOutput().fill("lots");
  await save().click();
  await vi.waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(m.weather_forecast_toast_invalid()),
  );
  expect(put).not.toHaveBeenCalled();
});

test("a refused save is reported", async () => {
  put.mockResolvedValue({ error: { error: "Admin only" } });
  render(PlantForm);
  await expect.element(maxOutput()).toHaveValue("6");
  await save().click();
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.plant_toast_error()));
  expect(toast.success).not.toHaveBeenCalled();
});
