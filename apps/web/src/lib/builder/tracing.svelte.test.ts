import "../../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { presetView } from "../../../../../packages/builder/src/builder/camera.ts";
import type { Geometry, Scene } from "../../../../../packages/builder/src/builder/pv.ts";
import type { Placing, Projector, TraceEdit } from "@sunreye/builder";
import { replay } from "@sunreye/scene";
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

/** A canvas in the tracing mode, kept on the scene each edit hands back; `placing` held until a
 * ready shape is placed. */
async function tracing(
  start: Scene = EMPTY,
  held?: Placing,
): Promise<{
  readonly at: (x: number, z: number, height?: number) => [number, number];
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
      scene: start,
      placing: held,
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
    at: (x, z, height = 0) => {
      const { left, top } = canvas.getBoundingClientRect();
      const [px = 0, py = 0] = project?.([x, -z, height]) ?? [];

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

test("each edit is reported with its arguments, the reach in metres too, and replays to its scene", async () => {
  const { at, scenes, edits } = await tracing();

  await press("mouse", [at(2, 2)]);
  await press("mouse", [at(2, 8)]);
  await settle(() => scenes.length === 1);

  const [edit] = edits;

  expect(edit?.kind === "add" && "x" in edit.from).toBe(true);
  expect(edit?.kind === "add" && edit.reach > 0 && edit.reach < 2).toBe(true);
  expect(edit && replay(EMPTY, edit)).toMatchObject({ scene: scenes[0] });
});

test("a ready roof held is placed by the next click, centred on it, and reported", async () => {
  const size = { width: 6, depth: 4, eave: 3, ridge: 6 };
  const { at, scenes, edits } = await tracing(EMPTY, { kind: "roof", id: "satteldach", size });

  await press("mouse", [at(5, 5)]);
  await settle(() => scenes.length === 1);

  const [edit] = edits;

  expect(edit).toMatchObject({ kind: "roof", id: "satteldach", size });
  expect(edit?.kind === "roof" && [edit.at.x, edit.at.z].map((v) => Math.round(v))).toEqual([2, 3]);
  expect(edit && replay(EMPTY, edit)).toMatchObject({ scene: scenes[0] });
});

test("a ready dormer held is placed on the face under the next click", async () => {
  const size = { width: 6, depth: 4, eave: 3, ridge: 6 };
  const house = replay(EMPTY, { kind: "roof", id: "satteldach", at: { x: 2, z: 3 }, size });
  const start = "refused" in house ? EMPTY : house.scene;
  const dormer = { width: 1, depth: 1 };

  const { at, scenes, edits } = await tracing(start, {
    kind: "dormer",
    id: "schleppgaube",
    size: dormer,
  });

  // Tapped where the face is drawn, 4.5 m up near the house's corner, not over the ground under it.
  await press("mouse", [at(3, 4, 4.5)]);
  await settle(() => scenes.length === 1);

  const [edit] = edits;

  expect(edit).toMatchObject({ kind: "dormer", block: 0, id: "schleppgaube", size: dormer });
  expect(edit?.kind === "dormer" && [edit.at.x, edit.at.z].map((v) => v.toFixed(1))).toEqual([
    "3.0",
    "4.0",
  ]);
  expect(edit && replay(start, edit)).toMatchObject({ scene: scenes[0] });
});

test("a line nearly square to the last snaps square, its guide and angle shown; Shift draws free", async () => {
  const { at, edits, scenes } = await tracing();

  await press("mouse", [at(2, 2)]);
  await press("mouse", [at(2, 8)]);
  await settle(() => scenes.length === 1);

  const [x, y] = at(8, 8.3);

  await cdp().send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await expect.element(page.getByText("6,00 m · 90° · Umschalt: frei")).toBeVisible();
  expect(document.querySelector("[data-guide]")).not.toBeNull();

  await press("mouse", [[x, y]]);
  await settle(() => scenes.length === 2);

  const square = edits[1]?.kind === "add" ? edits[1].to : undefined;

  expect(square && "z" in square ? square.z : Number.NaN).toBeCloseTo(8, 6);

  const [fx, fy] = at(8.3, 2.3);
  const shift = { button: "left", clickCount: 1, modifiers: 8, x: fx, y: fy } as const;

  await cdp().send("Input.dispatchMouseEvent", { ...shift, type: "mousePressed" });
  await cdp().send("Input.dispatchMouseEvent", { ...shift, type: "mouseReleased" });
  await settle(() => scenes.length === 3);

  const free = edits[2]?.kind === "add" ? edits[2].to : undefined;

  expect(free && "x" in free ? free.x : Number.NaN).toBeCloseTo(8.3, 1);
});
