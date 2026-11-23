/// <reference types="bun" />
import { expect, test } from "bun:test";
import { additions } from "../additions.ts";
import { misplacedText } from "../checks.ts";
import { picked } from "@sunreye/builder/builder/levels.ts";
import { addGrid, withoutBlock } from "@sunreye/builder/builder/modules.ts";
import { place } from "@sunreye/builder/builder/placing.ts";
import { loadPv } from "@sunreye/pv-wasm";
import type { Point, RoofWindow, Scene } from "@sunreye/builder/builder/pv.ts";
import { buildScene } from "@sunreye/builder/builder/scene.ts";
import { drag, handles, type Ray, type Target } from "@sunreye/builder/builder/handles/grips.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

const SIZES = { 7: { width: 1.134, height: 1.722 } };

/** 0.78 m across and 1.18 m up the south face, its centre 3 m across and 2 m up. */
const WINDOW: RoofWindow = { block: 0, face: 1, across: 3, up: 2, width: 0.78, length: 1.18 };

const block = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

/** A 10 m × 8 m gable house, eaves 3 m, pitched 35°, its front facing south, one roof window. */
const scene: Scene = { north: 0, blocks: [block], obstacles: [], roofWindows: [WINDOW] };

const laid = pv.modules(scene, SIZES);
const TARGET: Target = { kind: "roofWindow", index: 0 };

/** The point of the scene `across` and `up` the south face, which rises 35° from (0, −8, 3). */
function onSouth(across: number, up: number): Point {
  const pitch = (35 * Math.PI) / 180;

  return [across, -8 + up * Math.cos(pitch), 3 + up * Math.sin(pitch)];
}

const mm = (point: readonly number[] = []) => point.map((metres) => Math.round(metres * 1000));

test("the crate lays a roof window's pane in its face, and the scene draws it framed", () => {
  const { roofWindows } = pv.geometry(scene);

  expect(roofWindows?.[0]?.map((corner) => mm(corner))).toEqual([
    mm(onSouth(2.61, 1.41)),
    mm(onSouth(3.39, 1.41)),
    mm(onSouth(3.39, 2.59)),
    mm(onSouth(2.61, 2.59)),
  ]);
  expect(laid.panes).toEqual(roofWindows ?? []);

  const drawn = buildScene(pv.geometry(scene)).getObjectsByProperty("name", "roofWindow");

  // Its frame and, within it, its glass.
  expect(drawn).toHaveLength(2);
  expect(drawn[0]?.castShadow).toBe(false);
});

test("a roof window off its face is not drawn, and the handles still outline it", () => {
  const off: Scene = { ...scene, roofWindows: [{ ...WINDOW, across: 9.9 }] };

  expect(pv.geometry(off).roofWindows).toBeNull();
  expect(handles(off, TARGET, pv.modules(off, SIZES))).toHaveLength(1);
  expect(handles(scene, TARGET)).toEqual([]);
});

/** The level a strike at `point` drills to. */
const at = (point: Point) => picked(scene, { kind: "point", point }, pv);

test("a strike on a roof window drills to it; on the roof beside it, to its block", () => {
  expect(at(onSouth(3.2, 2.4))).toEqual({ kind: "roofWindow", index: 0 });
  expect(at(onSouth(5, 2))).toEqual({ kind: "block", index: 0 });
});

test("a roof window's one handle outlines its pane, at the middle of its upper edge", () => {
  const [move, ...rest] = handles(scene, TARGET, laid);
  const [east, north, up] = onSouth(3, 2.59);

  expect(rest).toEqual([]);
  expect(move?.grip).toBe("move");
  expect(move?.outline).toHaveLength(4);
  // three.js: x east, y up, z south.
  expect(mm(move?.at)).toEqual(mm([east, up, -north]));
});

/** Straight down onto three.js's `x`, `z`. */
const down = (x: number, z: number): Ray => ({ origin: [x, 50, z], direction: [0, -1, 0] });

/** The window of `from` after a drag from its centre by `east` and `north` metres. */
function slid(from: Scene, east: number, north: number): Scene | undefined {
  const [x, y, height] = onSouth(3, 2);

  return drag(
    from,
    TARGET,
    { grip: "move", ray: down(x, -y), height },
    down(x + east, -y - north),
    { pv, laid: pv.modules(from, SIZES) },
  )?.scene;
}

test("a roof window slides along its face in 10 cm steps and stops at a chimney", () => {
  // 0.82 m north, seen from above, is 1 m up the 35° slope.
  expect(slid(scene, -1.04, 0.82)?.roofWindows).toEqual([{ ...WINDOW, across: 2, up: 3 }]);

  // The chimney starts 5.2 m across: the window's right side stops there.
  const chimney = { block: 0, face: 1, across: 5.5, up: 2, width: 0.6, depth: 0.6, height: 1 };
  const stopped = slid({ ...scene, chimneys: [chimney] }, 2, 0)?.roofWindows?.[0];

  expect(stopped?.across).toBeCloseTo(5.2 - 0.39, 3);
});

/** The house with modules 0.3 m and 4.5 m across its south face, 0.5 m up. */
const moduled = place(addGrid(scene, 0, 1, 7), 0, [
  { across: 0.3, up: 0.5, landscape: false },
  { across: 4.5, up: 0.5, landscape: false },
]);

test("a module under a roof window is misplaced, and a window moved onto modules covers them", () => {
  expect(pv.modules(moduled, SIZES).misplaced).toBeNull();

  // 2 m east: on the second module, which spans 4.5 m to 5.634 m.
  const moved = slid(moduled, 2, 0) ?? moduled;
  const { misplaced } = pv.modules(moved, SIZES);

  expect(misplaced).toMatchObject({ kind: "window", grid: 0, module: 1 });
  expect(misplaced && misplacedText(misplaced)).toBe(
    "Raster 1: Modul 2 liegt auf einem Dachfenster.",
  );
  expect(pv.covered(moved, SIZES)).toEqual([[0, 1]]);
  // The grid's roof under it is shaded with the chimneys'.
  expect(pv.modules(moved, SIZES).grids[0]?.blocked).toHaveLength(1);
});

test("a new roof window goes where the crate finds room, off the modules", () => {
  const plan = {
    draft: { scene: moduled, strings: [] },
    laid: pv.modules(moduled, SIZES),
    pv,
    sizes: SIZES,
    devices: [],
    cold: [],
    sized: [],
    inputs: {},
    refused: null,
  };

  const added = additions("buildings", plan, 7).find(
    ({ label }) => label === "Dachfenster hinzufügen",
  );

  // The north face comes first: its middle across, three fifths up.
  expect(added?.level).toEqual({ kind: "roofWindow", index: 1 });
  expect(added?.draft.scene.roofWindows?.[1]).toEqual({
    block: 0,
    face: 0,
    across: 5,
    up: 2.9,
    width: 0.78,
    length: 1.18,
  });
  expect(pv.geometry(added?.draft.scene ?? scene).roofWindows).toHaveLength(2);
});

test("removing a block drops the roof windows in its roof and renumbers those of later blocks", () => {
  const two: Scene = {
    ...scene,
    blocks: [block, block],
    roofWindows: [WINDOW, { ...WINDOW, block: 1 }],
  };

  expect(withoutBlock(two, 0).roofWindows).toEqual([WINDOW]);
});
