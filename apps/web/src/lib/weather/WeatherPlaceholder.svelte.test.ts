// A placeholder stands at the size of what replaces it, loading and empty alike (ADR 21).
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { DRY, show } from "./weather-detail.harness.ts";
import WeatherDetail from "./WeatherDetail.svelte";
import type { WeatherReader } from "./weather.ts";

const hours = () => page.getByRole("region", { name: "Wetter nach Stunden" });

const height = () => hours().element().getBoundingClientRect().height;

test("loading and without stored weather the hours stand at the size of a day's weather", async () => {
  const { screen } = await show({ forecasts: DRY });

  await expect.element(screen.getByRole("img", { name: "Temperatur", exact: true })).toBeVisible();
  const loaded = height();

  await screen.unmount();
  const empty = await show({});

  await expect.element(empty.screen.getByText("Keine Wetterdaten")).toBeVisible();
  const none = height();

  await empty.screen.unmount();
  await render(WeatherDetail, { core: {} as WeatherReader, day: undefined });

  await expect.element(page.getByRole("status")).toBeVisible();

  expect(height()).toBe(none);
  // Within a line of the day it stands for.
  expect(Math.abs(none - loaded)).toBeLessThan(24);
});
