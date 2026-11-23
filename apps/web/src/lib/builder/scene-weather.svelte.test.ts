import "../../app.css";
import { test } from "vitest";
import { render } from "vitest-browser-svelte";
import { DRY, type SceneWeather } from "@sunreye/builder/scene/weather.ts";
import type { Geometry } from "@sunreye/builder/builder/pv.ts";
import { SceneCanvas } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";
import { canvasWords } from "./canvas-words.ts";

// The weather on the drawn scene (ADR 23 "Scene weather"), read off the canvas's middle.

const square = (up: number) =>
  [
    [0, -4, up],
    [4, -4, up],
    [4, 0, up],
    [0, 0, up],
  ] as const;

/** A flat roof 3 m up, seen from 30 m straight above. */
const flat: Geometry = { faces: [{ surface: "roof", corners: square(3) }], solids: [] };

/** One module over the roof's middle. */
const module = { corners: square(3.01).map(([e, n, u]) => [1 + e / 2, -1 + n / 2, u] as const) };

/** The canvas's middle, where the roof is, and its corner, where nothing stands. */
const MIDDLE = 0.5;
const CORNER = 0.02;

/** Draws the roof under a noon sun, `covered` by the module; gives the brightness, 0 to 255,
 * `at` of the way across and down the canvas as last drawn, and the screen. */
async function fromAbove(covered: boolean, at: number) {
  document.documentElement.classList.remove("dark");

  const read = document.createElement("canvas");
  const context = read.getContext("2d", { willReadFrequently: true });
  let brightness = 0;

  const screen = await render(SceneCanvas, {
    words: canvasWords(),
    geometry: flat,
    panels: covered ? [{ ...module, string: 0 }] : [],
    shares: covered ? [0] : [],
    sun: [0, -0.5, 0.866],
    view: { position: [2, 33, 2.01], target: [2, 3, 2] },
    onview: () => {},
    // Read in the draw that made it: the drawing buffer is cleared once presented.
    onrender: () => {
      const canvas = document.querySelector("canvas");

      if (canvas === null || context === null || canvas.width === 0) return;

      read.width = read.height = 1;
      context.drawImage(canvas, canvas.width * at, canvas.height * at, 1, 1, 0, 0, 1, 1);

      const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

      brightness = (r + g + b) / 3;
    },
  });

  return { drawn: () => brightness, screen };
}

test.each<readonly [string, Partial<SceneWeather>, boolean, number, number]>([
  ["rain darkens the wet roof", { wet: 1 }, false, -10, MIDDLE],
  ["lying snow whitens the roof", { snow: true }, false, 3, MIDDLE],
  ["snow-covered modules draw white", { snow: true, covered: true }, true, 100, MIDDLE],
  ["thunder darkens the day", { thunder: true }, false, -10, MIDDLE],
  // As thick as the codes 45 and 48 make it.
  ["fog greys the air round the plant", { fog: 0.59 }, false, -20, CORNER],
])("%s, and dry again the scene is as it was", async (_, weather, covered, change, at) => {
  const { drawn, screen } = await fromAbove(covered, at);

  await settle(() => drawn() > (covered ? 0 : 100));

  const dry = drawn();

  await screen.rerender({ weather: { ...DRY, ...weather } });

  await settle(() => Math.sign(change) * (drawn() - dry) > Math.abs(change));

  await screen.rerender({ weather: DRY });
  await settle(() => Math.abs(drawn() - dry) < 2);
});
