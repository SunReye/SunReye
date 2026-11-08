import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { readable } from "svelte/store";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const put = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, PUT: put } }));
const admin = { id: 1, name: "Ada", email: "ada@example.com", admin: true };
let signedIn: { user: typeof admin } = { user: admin };
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: signedIn, isPending: false }),
}));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));

const { default: WeatherForm } = await import("./weather-form.svelte");

type WeatherConfig = components["schemas"]["WeatherConfig"];

const STORED: WeatherConfig = {
  enabled: true,
  latitude: 52.5,
  longitude: 13.4,
  label: "Berlin",
  forecast: {
    enabled: true,
    provider: "open-meteo",
    arrays: [{ kwp: 8.4, tilt: 30, azimuth: 0 }],
    battery: null,
    correction: { enabled: false },
    houseLoadW: 400,
    maxOutputW: 6000,
    smartMeterSince: "2024-03-01",
    systemLoss: 14,
    tempCoefficient: -0.35,
  } as WeatherConfig["forecast"],
};
const PROVIDERS = [
  { id: "open-meteo", label: "Open-Meteo", capabilities: {} },
  { id: "other", label: "Other Provider", capabilities: {} },
];
const CORRECTION = {
  cells: [],
  enabled: false,
  learnedThrough: null,
  skill: { samples: 0 },
};

beforeEach(() => {
  signedIn = { user: admin };
  get.mockImplementation(async (path: string) => {
    if (path === "/api/settings/weather") return { data: STORED };
    if (path === "/api/forecast/providers") return { data: PROVIDERS };
    if (path === "/api/forecast/correction") return { data: CORRECTION };
    return { data: undefined };
  });
  put.mockImplementation(async (_path: string, { body }: { body: object }) => ({
    data: { ...STORED, ...body },
  }));
});
afterEach(() => {
  for (const fn of [get, put, toast.success, toast.error]) fn.mockReset();
});

const save = () => page.getByRole("button", { name: m.action_save(), exact: true });

test("shows the stored weather settings from the core", async () => {
  render(WeatherForm);
  await expect.element(page.getByLabelText(m.weather_latitude())).toHaveValue("52.5");
  await expect.element(page.getByLabelText(m.weather_longitude())).toHaveValue("13.4");
  await expect.element(page.getByLabelText(m.weather_location_name())).toHaveValue("Berlin");
  expect(get).toHaveBeenCalledWith("/api/settings/weather");
  expect(get).toHaveBeenCalledWith("/api/forecast/providers");
});

test("offers the core's forecast providers", async () => {
  render(WeatherForm);
  await expect.element(page.getByText("Open-Meteo")).toBeVisible();
});

test("saving sends only the fields this form owns, and reports it", async () => {
  render(WeatherForm);
  const lat = page.getByLabelText(m.weather_latitude());
  await expect.element(lat).toHaveValue("52.5");
  await lat.fill("48.1");
  await save().click();
  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.weather_toast_saved()));
  expect(put).toHaveBeenCalledWith("/api/settings/weather", {
    body: {
      enabled: true,
      latitude: 48.1,
      longitude: 13.4,
      label: "Berlin",
      forecast: { enabled: true, provider: "open-meteo", correction: { enabled: false } },
    },
  });
});

test("a refused save is reported and keeps the form editable", async () => {
  put.mockResolvedValue({ error: { error: "Admin only" } });
  render(WeatherForm);
  await expect.element(page.getByLabelText(m.weather_latitude())).toHaveValue("52.5");
  await save().click();
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.weather_toast_error()));
  expect(toast.success).not.toHaveBeenCalled();
});

test("coordinates that do not parse are refused before anything is sent", async () => {
  render(WeatherForm);
  const lat = page.getByLabelText(m.weather_latitude());
  await expect.element(lat).toHaveValue("52.5");
  await lat.fill("north");
  await save().click();
  await vi.waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(m.weather_toast_invalid_coords()),
  );
  expect(put).not.toHaveBeenCalled();
});

test("a viewer who is not an admin cannot save", async () => {
  signedIn = { user: { ...admin, admin: false } };
  render(WeatherForm);
  await expect.element(page.getByLabelText(m.weather_latitude())).toBeDisabled();
  await expect.element(save()).toBeDisabled();
});
