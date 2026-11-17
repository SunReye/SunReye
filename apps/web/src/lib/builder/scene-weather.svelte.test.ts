import "../../app.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { DRY, type SceneWeather } from "../scene/weather.ts";
import type { Geometry } from "./pv.ts";
import SceneCanvas from "./SceneCanvas.svelte";

// The weather on the drawn scene (ADR 23 "Scene weather"), read off the canvas's middle.

// Software GL renders the sky and shadows slowly while other suites run.
const SLOW = { timeout: 15_000 };

const square = (up: number) =>
  [
    [0, -4, up],
    [4, -4, up],
    [4, 0, up],
    [0, 0, up],
  ] as const;

/** A flat roof 3 m up, seen from straight above. */
const flat: Geometry = { faces: [{ surface: "roof", corners: square(3) }], solids: [] };

/** One module over the roof's middle. */
const module = { corners: square(3.01).map(([e, n, u]) => [1 + e / 2, -1 + n / 2, u] as const) };

/** Draws the roof under a noon sun, `covered` by the module; gives the brightness, 0 to 255, of
 * the canvas's middle as last drawn, and the screen. */
async function fromAbove(covered: boolean) {
  document.documentElement.classList.remove("dark");

  const read = document.createElement("canvas");
  const context = read.getContext("2d", { willReadFrequently: true });
  let brightness = 0;

  const screen = await render(SceneCanvas, {
    geometry: flat,
    panels: covered ? [{ ...module, string: 0 }] : [],
    shares: covered ? [0] : [],
    sun: [0, -0.5, 0.866],
    view: { position: [2, 12, 2.01], target: [2, 3, 2] },
    onview: () => {},
    // Read in the draw that made it: the drawing buffer is cleared once presented.
    onrender: () => {
      const canvas = document.querySelector("canvas");

      if (canvas === null || context === null || canvas.width === 0) return;

      read.width = read.height = 1;
      context.drawImage(canvas, canvas.width / 2, canvas.height / 2, 1, 1, 0, 0, 1, 1);

      const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

      brightness = (r + g + b) / 3;
    },
  });

  return { drawn: () => brightness, screen };
}

test.each<readonly [string, Partial<SceneWeather>, boolean, number]>([
  ["rain darkens the wet roof", { wet: 1 }, false, -10],
  ["lying snow whitens the roof", { snow: true }, false, 3],
  ["snow-covered modules draw white", { snow: true, covered: true }, true, 100],
  ["thunder darkens the day", { thunder: true }, false, -10],
])("%s, and dry again the scene is as it was", async (_, weather, covered, change) => {
  const { drawn, screen } = await fromAbove(covered);

  await expect.poll(drawn, SLOW).toBeGreaterThan(covered ? 0 : 100);

  const dry = drawn();

  await screen.rerender({ weather: { ...DRY, ...weather } });
  await expect
    .poll(() => Math.sign(change) * (drawn() - dry), SLOW)
    .toBeGreaterThan(Math.abs(change));

  await screen.rerender({ weather: DRY });
  await expect.poll(() => Math.abs(drawn() - dry), SLOW).toBeLessThan(2);
});
