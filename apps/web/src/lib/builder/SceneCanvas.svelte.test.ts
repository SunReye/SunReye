import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { presetView, type View } from "./camera.ts";
import type { Geometry } from "./pv.ts";
import SceneCanvas from "./SceneCanvas.svelte";

const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, -8, 3],
        [0, -8, 3],
      ],
    },
  ],
  solids: [{ kind: "sphere", centre: [-4, 0, 8], radius: 2 }],
};

test("the scene is drawn on a labelled canvas", async () => {
  const screen = await render(SceneCanvas, {
    geometry: house,
    view: presetView("isometric", house),
    onview: () => {},
  });

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).toBeVisible();
});

test("dragging the canvas orbits the camera and reports the new view", async () => {
  const start = presetView("south", house);
  const views: View[] = [];

  const screen = await render(SceneCanvas, {
    geometry: house,
    view: start,
    onview: (view: View) => {
      views.push(view);
    },
  });

  const canvas = screen.getByLabelText("3D-Szene des Hauses");

  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 100, y: 100 },
    targetPosition: { x: 250, y: 100 },
  });

  await expect.poll(() => views.length).toBeGreaterThan(0);
  expect(views.at(-1)?.target).toEqual(start.target);
  expect(views.at(-1)?.position).not.toEqual(start.position);
});
