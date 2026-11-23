import "../../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { presetView } from "../../../../../packages/builder/src/builder/camera.ts";
import type { Geometry, Scene } from "../../../../../packages/builder/src/builder/pv.ts";
import type { Projector, TraceEdit } from "@sunreye/builder";
import { SceneCanvas } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";
import { press } from "./pointer.harness.ts";

// Tracing a roof on the canvas (ADR 20): seen from above, each click joins the last and snaps,
// the snap is named and the line's length follows the pointer, and every closed loop is a face.

/** The plain ground under the tracing, 12 m square, seen from above. */
const ground: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [-1, 1, 0],
        [11, 1, 0],
        [11, -11, 0],
        [-1, -11, 0],
      ],
    },
  ],
  solids: [],
};

const EMPTY: Scene = { north: 0, blocks: [], obstacles: [] };

afterEach(() => {
  vi.restoreAllMocks();
});

/** A canvas in the tracing mode, kept on the scene each edit hands back. */
async function tracing(): Promise<{
  readonly at: (x: number, z: number) => [number, number];
  readonly scenes: Scene[];
  readonly edits: TraceEdit[];
}> {
  const scenes: Scene[] = [];
  const edits: TraceEdit[] = [];
  let project: Projector | undefined;

  const screen = await render(SceneCanvas, {
    geometry: ground,
    view: presetView("top", ground),
    onview: () => {},
    onrender: (next: Projector) => {
      project = next;
    },
    tracing: {
      scene: EMPTY,
      ontrace: (scene: Scene, edit: TraceEdit) => {
        traced(scene, edit);
      },
    },
  });

  const traced = (scene: Scene, edit: TraceEdit): void => {
    scenes.push(scene);
    edits.push(edit);
    void screen.rerender({ tracing: { scene, ontrace: traced } });
  };

  await settle(() => project !== undefined);

  const canvas = screen.getByLabelText("3D-Szene des Hauses").element();

  return {
    // Scene x and z to page pixels: north 0, so east is x and north is −z.
    at: (x, z) => {
      const { left, top } = canvas.getBoundingClientRect();
      const [px = 0, py = 0] = project?.([x, -z, 0]) ?? [];

      return [left + px, top + py];
    },
    scenes,
    edits,
  };
}

test("four lines clicked into a loop make one face; a click near the first corner snaps", async () => {
  const { at, scenes } = await tracing();

  for (const [x, z] of [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one click after another, as the person traces.
    await press("mouse", [at(x, z)]);
  }

  const [x, y] = at(2, 2);

  await press("mouse", [[x + 4, y - 3]]);
  await settle(() => scenes.length === 4);

  expect(scenes.at(-1)?.blocks[0]?.freeForm?.faces).toHaveLength(1);
  expect(scenes.at(-1)?.blocks[0]?.freeForm?.traced?.points).toHaveLength(4);
});

test("the line being drawn shows its length and the snap it would take", async () => {
  const { at, scenes } = await tracing();

  await press("mouse", [at(2, 2)]);
  await press("mouse", [at(2, 8)]);
  await settle(() => scenes.length === 1);

  const [x, y] = at(2, 2);

  await cdp().send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 3, y: y + 2 });

  await expect.element(page.getByText("6,00 m · Punkt")).toBeVisible();
});

test("a traced line dragged moves, and its faces follow", async () => {
  const { at, scenes, edits } = await tracing();

  for (const [x, z] of [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
    [2, 2],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one click after another, as the person traces.
    await press("mouse", [at(x, z)]);
  }

  await settle(() => scenes.length === 4);
  await press("mouse", [at(8, 5), at(8.5, 5), at(9, 5)]);
  await settle(() => scenes.length === 5);

  expect(edits.at(-1)).toMatchObject({ kind: "move" });
  expect(scenes.at(-1)?.blocks[0]?.freeForm?.faces[0]?.map(([x = 0]) => Math.round(x))).toEqual(
    expect.arrayContaining([2, 9]),
  );
});
