// The builder speaks the language its consumer sets (ADR 25 "Its language"): unset, the one
// Paraglide's local-storage key holds, as Home keeps it; a change shows without a reload.
import "../../app.css";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Geometry } from "@sunreye/pv-wasm";
import { presetView, SceneCanvas, speak } from "@sunreye/builder";

const house: Geometry = { faces: [], solids: [] };

afterEach(() => {
  speak(null);
});

test("the consumer's locale names the canvas, and a change renames it without a reload", async () => {
  await render(SceneCanvas, { geometry: house, view: presetView("top", house), onview: () => {} });

  await expect.element(page.getByLabelText("3D-Szene des Hauses")).toBeVisible();

  speak("en");
  await expect.element(page.getByLabelText("3D scene of the house")).toBeVisible();

  speak(null);
  await expect.element(page.getByLabelText("3D-Szene des Hauses")).toBeVisible();
});
