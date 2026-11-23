// The consumer's aerial image as the canvas shows it (ADR 20): north up and east right on the
// ground, and on a roof the part of the image straight beneath it.
import "../../app.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { settle } from "../motion/clock.harness.ts";
import type { Geometry, Point } from "@sunreye/builder/builder/pv.ts";
import type { Projector } from "@sunreye/builder/builder/drawing.svelte.ts";
import { SceneCanvas } from "@sunreye/builder";
import type { Aerial } from "@sunreye/builder/builder/supplied.ts";
import { canvasWords } from "./canvas-words.ts";

/** The image's quarters, each one colour: north-west red, north-east green, south-west blue,
 * south-east yellow. */
function quarters(): Aerial {
  const image = document.createElement("canvas");
  const pen = image.getContext("2d");

  image.width = 64;
  image.height = 64;

  if (pen !== null) {
    for (const [colour, left, top] of [
      ["#ff0000", 0, 0],
      ["#00ff00", 32, 0],
      ["#0000ff", 0, 32],
      ["#ffff00", 32, 32],
    ] as const) {
      pen.fillStyle = colour;
      pen.fillRect(left, top, 32, 32);
    }
  }

  // 30 m a side, its middle 5 m east and north of the scene's origin.
  return { image, extent: { west: -10, south: -10, east: 20, north: 20 } };
}

/** A flat roof 3 m up over the south-east quarter. */
const shed: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [12, -8, 3],
        [18, -8, 3],
        [18, -3, 3],
        [12, -3, 3],
      ],
    },
  ],
  solids: [],
};

type Colour = readonly [number, number, number];

/** The colour the canvas shows at each point, read in the draw that made it. */
async function seen(points: readonly Point[]): Promise<Colour[]> {
  const read = document.createElement("canvas");
  const context = read.getContext("2d", { willReadFrequently: true });
  let colours: Colour[] = [];

  await render(SceneCanvas, {
    words: canvasWords(),
    geometry: shed,
    around: { aerial: quarters(), neighbours: [] },
    sun: [0.3, -0.3, 0.9],
    // From high above the image's middle, a little south.
    view: { position: [5, 60, -5 + 8], target: [5, 0, -5] },
    onview: () => {},
    onrender: (project: Projector) => {
      const canvas = document.querySelector("canvas");

      if (canvas === null || context === null || canvas.width === 0) return;

      const scale = canvas.width / canvas.clientWidth;

      read.width = canvas.width;
      read.height = canvas.height;
      context.drawImage(canvas, 0, 0);
      colours = points.flatMap((point) => {
        const [x, y] = project(point) ?? [-1, -1];
        const [r = 0, g = 0, b = 0] = context.getImageData(x * scale, y * scale, 1, 1).data;

        return x < 0 ? [] : [[r, g, b] as const];
      });
    },
  });

  await settle(() => colours.length === points.length);

  return colours;
}

/** Which of red, green, blue or yellow a colour is nearest. */
function hue([r, g, b]: Colour): string {
  if (b > r && b > g) return "blue";

  if (r > 2 * b && g > 2 * b && Math.abs(r - g) < 0.4 * Math.max(r, g)) return "yellow";

  return r > g ? "red" : "green";
}

test("the image lies north up and east right, and a roof shows the part straight beneath it", async () => {
  const colours = await seen([
    [-5, 15, 0],
    [15, 15, 0],
    [-5, -5, 0],
    [8, 2, 0],
    [15, -5.5, 3],
    [-9, 19.5, 0],
    [19.5, -9.5, 0],
  ]);

  expect(colours.map((colour) => hue(colour))).toEqual([
    "red",
    "green",
    "blue",
    "yellow",
    "yellow",
    "red",
    "yellow",
  ]);
});
