import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { components } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { default: Panel } = await import("./forecast-correction-panel.svelte");

type View = components["schemas"]["CorrectionView"];
const learned: View = {
  enabled: true,
  learnedThrough: "2026-07-20",
  skill: { maeRaw: 400, maeCorrected: 300, improvementPct: 25, samples: 12.4 },
  cells: [
    { month: 7, hour: 13, factor: 1.15, weight: 5 },
    { month: 12, hour: 0, factor: 0.6, weight: 30 },
  ],
};

afterEach(() => {
  get.mockReset();
});

test("shows the core's learned skill and the last day learned", async () => {
  get.mockResolvedValue({ data: learned });
  render(Panel);
  await expect.element(page.getByText("25%")).toBeVisible();
  await expect
    .element(page.getByText(`12 ${m.weather_forecast_correction_samples()}`))
    .toBeVisible();
  await expect
    .element(page.getByText(`${m.weather_forecast_correction_learned_through()} 2026-07-20`))
    .toBeVisible();
  expect(get).toHaveBeenCalledWith("/api/forecast/correction");
});

test("a correction with no cells yet says so", async () => {
  get.mockResolvedValue({
    data: { ...learned, learnedThrough: null, cells: [] },
  });
  render(Panel);
  await expect.element(page.getByText(m.weather_forecast_correction_empty())).toBeVisible();
});
