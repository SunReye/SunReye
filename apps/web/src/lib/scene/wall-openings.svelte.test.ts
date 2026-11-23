import "../../app.css";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import type { Fitted, Geometry, Point } from "../../../../../packages/builder/src/builder/pv.ts";
import type { Projector } from "../../../../../packages/builder/src/builder/drawing.svelte.ts";
import { SceneCanvas } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";

/** Eight windows along a 20 m wall that faces south, each 1.2 m wide from 0.9 m to 2.3 m up. */
const windows: Fitted[] = Array.from({ length: 8 }, (_, i) => {
  const east = 1 + i * 2.4;

  return {
    kind: "window",
    corners: [
      [east, 0, 0.9],
      [east + 1.2, 0, 0.9],
      [east + 1.2, 0, 2.3],
      [east, 0, 2.3],
    ],
    out: [0, -1, 0],
  };
});

const street: Geometry = {
  faces: [
    {
      surface: "wall",
      corners: [
        [0, 0, 0],
        [20, 0, 0],
        [20, 0, 3],
        [0, 0, 3],
      ],
    },
  ],
  solids: [],
  openings: windows,
};

const NOON: Point = [0, -0.5, 0.866];
const MIDNIGHT: Point = [0, -0.5, -0.866];

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

/** Draws the wall from the south under `sun`; the reader says which panes glow warm, as last drawn. */
async function wall(sun: Point): Promise<() => boolean[] | undefined> {
  const read = document.createElement("canvas");
  const context = read.getContext("2d", { willReadFrequently: true });
  let warm: boolean[] | undefined;

  await render(SceneCanvas, {
    geometry: street,
    sun,
    view: { position: [10, 1.6, 22], target: [10, 1.6, 0] },
    onview: () => {},
    // Read in the draw that made it: the drawing buffer is cleared once presented.
    onrender: (project: Projector) => {
      const canvas = document.querySelector("canvas");

      if (canvas === null || context === null || canvas.width === 0 || canvas.clientWidth === 0) {
        return;
      }

      read.width = canvas.width;
      read.height = canvas.height;
      context.drawImage(canvas, 0, 0);

      const scale = canvas.width / canvas.clientWidth;

      warm = windows.map(({ corners: [low] }) => {
        // The middle of the left casement, clear of the curtain.
        const at = project([low[0] + 0.42, 0, low[2] + 0.5]);

        // Before its first layout the canvas has no size to project onto.
        if (at === null || !at.every((v) => Number.isFinite(v))) return false;

        const [r = 0, , b = 0] = context.getImageData(
          Math.round(at[0] * scale),
          Math.round(at[1] * scale),
          1,
          1,
        ).data;

        return r > 110 && r > b * 1.4;
      });
    },
  });

  return () => warm;
}

test("at night some windows glow warm, the same ones every time; by day none do", async () => {
  const first = await wall(MIDNIGHT);

  await settle(() => first()?.some(Boolean) === true);

  const lit = first() ?? [];

  expect(lit.filter(Boolean).length).toBeLessThan(windows.length);

  document.body.replaceChildren();

  const again = await wall(MIDNIGHT);

  await settle(() => again()?.some(Boolean) === true);
  expect(again()).toEqual(lit);

  document.body.replaceChildren();

  const day = await wall(NOON);

  await settle(() => day()?.length === windows.length);
  expect(day()).toEqual(windows.map(() => false));
});
