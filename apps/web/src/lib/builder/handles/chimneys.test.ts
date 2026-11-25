/// <reference types="bun" />
import { expect, test } from "bun:test";
import { picked } from "../../../../../../packages/builder/src/builder/levels.ts";
import { loadPv } from "@sunreye/pv-wasm";
import type { Chimney, Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import {
  drag,
  handles,
  type Ray,
  type Target,
} from "../../../../../../packages/builder/src/builder/handles/grips.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** 0.6 m square and 1.2 m tall on the south face, its centre 3 m across and 1.5 m up. */
const CHIMNEY: Chimney = {
  block: 0,
  face: 1,
  across: 3,
  up: 1.5,
  width: 0.6,
  depth: 0.6,
  height: 1.2,
};

/** A 10 m × 8 m gable house, eaves 3 m, pitched 35°, its front facing south, one chimney. */
const scene: Scene = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [],
  chimneys: [CHIMNEY],
};

const laid = pv.modules(scene, {});
const { roofs } = laid;
const TARGET: Target = { kind: "chimney", index: 0 };

const rounded = (point: readonly number[] = []) =>
  point.map((m) => Math.round(m * 1000) / 1000 + 0);

test("a roof face carries its frame: the south face's lowest left corner, across east, up the slope", () => {
  const south = roofs[1];

  expect(rounded(south?.origin)).toEqual([0, -8, 3]);
  expect(rounded(south?.across)).toEqual([1, 0, 0]);
  expect(rounded(south?.up)).toEqual([0, 0.819, 0.574]);
});

/** Its top stands 1.2 m over where its upper side meets the roof: 3 + 1.866 × sin 35° + 1.2. */
const TOP = 5.27;

const at = (east: number, north: number, up: number) =>
  picked(scene, { kind: "point", point: [east, north, up] }, pv);

test("a strike on a chimney's top or side drills to it; on the roof beside it, to its block", () => {
  expect(at(3, -6.771, TOP)).toEqual({ kind: "chimney", index: 0 });
  expect(at(3.1, -7.071, 4)).toEqual({ kind: "chimney", index: 0 });
  expect(at(4, -6.771, 3.86)).toEqual({ kind: "block", index: 0 });
});

test("a chimney's handle outlines its foot on the roof; an editor's ring lies round it", () => {
  const [move, ...rest] = handles(scene, TARGET, laid);

  expect(rest.map(({ grip }) => grip)).toEqual(["turn"]);
  expect(move?.grip).toBe("move");
  // Three.js's frame: x east, y up, z south.
  expect(move?.outline?.map((p) => p.map((m) => Math.round(m * 100) / 100 + 0))).toEqual([
    [2.7, 3.65, 7.07],
    [3.3, 3.65, 7.07],
    [3.3, 4.07, 6.47],
    [2.7, 4.07, 6.47],
  ]);
});

/** Straight down onto three.js's `x`, `z`. */
const down = (x: number, z: number): Ray => ({ origin: [x, 50, z], direction: [0, -1, 0] });

/** The chimney after a drag on its top from its centre by `east` and `north` metres. */
function slid(east: number, north: number): Chimney | undefined {
  const moved = drag(
    scene,
    TARGET,
    { grip: "move", ray: down(3, 6.771), height: TOP },
    down(3 + east, 6.771 - north),
    { pv, laid },
  );

  return moved?.scene.chimneys?.[0];
}

test("a chimney slides along its face in 10 cm steps as the pointer moves over it", () => {
  // 0.82 m north, seen from above, is 1 m up the 35° slope.
  expect(slid(2.04, 0.82)).toEqual({ ...CHIMNEY, across: 5, up: 2.5 });
});

test("a chimney dragged past its face stops at the edge, wholly on it, and slides along it", () => {
  const east = slid(20, 0);

  expect(east?.across).toBeCloseTo(9.7, 4);
  expect(east?.up).toBe(1.5);

  // Up the slope its upper side stops at the ridge, 4 / cos 35° = 4.883 m up the face.
  const corner = slid(20, 20);

  expect(corner?.across).toBeCloseTo(9.7, 4);
  expect(corner?.up).toBeCloseTo(4.883 - 0.3 / Math.cos((35 * Math.PI) / 180), 3);
  // The crate draws only a chimney standing wholly on its face.
  const drawn = pv.geometry({ ...scene, chimneys: [corner ?? CHIMNEY] }).faces;

  expect(drawn.filter(({ surface }) => surface === "chimney")).toHaveLength(5);
});

/** From a camera south of the house, 35° up, through three.js's `point`. */
function oblique(point: readonly [number, number, number]): Ray {
  const origin = [5, 20, 30] as const;
  const way = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]] as const;
  const length = Math.hypot(...way);

  return { origin, direction: [way[0] / length, way[1] / length, way[2] / length] };
}

test("seen from the side a chimney stays under the pointer: a metre up the slope is a metre up", () => {
  const south = roofs[1];

  if (south === undefined) throw new Error("no south face");

  /** Three.js's point `across` and `up` the south face. */
  const onFace = (across: number, up: number): [number, number, number] => {
    const [e, n, u] = south.origin.map(
      (from, axis) => from + (south.across[axis] ?? 0) * across + (south.up[axis] ?? 0) * up,
    );

    return [e ?? 0, u ?? 0, -(n ?? 0)];
  };

  const moved = drag(
    scene,
    TARGET,
    // Grabbed where it meets the roof.
    { grip: "move", ray: oblique(onFace(3, 1.5)), height: onFace(3, 1.5)[1] },
    oblique(onFace(5, 2.5)),
    { pv, laid },
  );

  expect(moved?.scene.chimneys?.[0]).toEqual({ ...CHIMNEY, across: 5, up: 2.5 });
  expect(moved?.value).toEqual([5, 2.5]);
});
