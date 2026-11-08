import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { default: WeatherTile } = await import("./weather-tile.svelte");

afterEach(() => get.mockReset());

test("reads the weather from the core and prints the reading", async () => {
  get.mockResolvedValue({
    data: {
      temperature: 18.4,
      unit: "°C",
      condition: "Clear",
      icon: "clear",
      solarRadiationSum: null,
      label: "Berlin",
      forecast: null,
    },
  });
  render(WeatherTile);
  await expect.element(page.getByText("18°C")).toBeVisible();
  expect(get).toHaveBeenCalledWith("/api/weather");
});

test("shows no tile while the core answers null", async () => {
  get.mockResolvedValue({ data: null });
  render(WeatherTile);
  await vi.waitFor(() => expect(get).toHaveBeenCalledWith("/api/weather"));
  await expect.element(page.getByText("Clear")).not.toBeInTheDocument();
});
