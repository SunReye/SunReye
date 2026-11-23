import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { WEATHER_EFFECTS, weatherEffects } from "@sunreye/builder/scene/weather-effects.svelte.ts";
import DisplaySettings from "./DisplaySettings.svelte";

// Settings › Display's Wettereffekte switch (ADR 23 "Off switch").

afterEach(() => {
  weatherEffects.on = true;
  localStorage.clear();
});

test("the Wettereffekte switch is on by default, kept per browser and read at once", async () => {
  const screen = await render(DisplaySettings);
  const effects = screen.getByRole("switch", { name: /^Wettereffekte/u });

  await expect.element(effects).toBeChecked();
  await expect
    .element(screen.getByText("Regen, Schnee, Nebel und Tropfen auf der Linse in der 3D-Szene."))
    .toBeVisible();

  await userEvent.click(effects);

  await expect.element(effects).not.toBeChecked();
  expect(weatherEffects.on).toBe(false);
  expect(localStorage.getItem(WEATHER_EFFECTS)).toBe("off");

  await userEvent.click(effects);

  await expect.element(effects).toBeChecked();
  expect(weatherEffects.on).toBe(true);
  expect(localStorage.getItem(WEATHER_EFFECTS)).toBe("on");
});
