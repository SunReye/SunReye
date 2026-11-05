import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";
import { emptyForm } from "./device-form";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: InverterSection } = await import("./inverter-section.svelte");

afterEach(() => get.mockReset());

async function served(pvAndBattery: boolean) {
  get.mockResolvedValue({ data: { pvAndBattery } });
  await coreCapabilities.load();
}

test("a core that keeps no PV arrays or pack per device shows no fields for them", async () => {
  await served(false);
  render(InverterSection, { form: emptyForm([]) });
  await expect.element(page.getByText(m.weather_forecast_temp_coeff())).not.toBeInTheDocument();
  await expect.element(page.getByText(m.weather_forecast_battery_usable())).not.toBeInTheDocument();
});

test("an engine that keeps them shows the inverter's arrays and pack", async () => {
  await served(true);
  render(InverterSection, { form: emptyForm([]) });
  await expect.element(page.getByText(m.weather_forecast_temp_coeff())).toBeVisible();
  await expect.element(page.getByText(m.weather_forecast_battery_usable())).toBeVisible();
});
