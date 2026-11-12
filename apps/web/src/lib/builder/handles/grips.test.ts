/// <reference types="bun" />
import { expect, test } from "bun:test";
import { nextBlock } from "../draft.ts";
import type { Block, Scene } from "../pv.ts";
import { drag, handles, type Grip, type Ray, type Target } from "./grips.ts";

const HOUSE = nextBlock([]);
const BLOCK: Target = { kind: "block", index: 0 };

const scene = (blocks: readonly Block[] = [HOUSE], north = 0): Scene => ({
  north,
  blocks,
  obstacles: [{ kind: "tree", x: -5, z: 10, radius: 2, height: 8 }],
});

/** Straight down onto scene point `x`, `z`, three.js's frame turned by `north` (pv's `turn`). */
function down(x: number, z: number, north = 0): Ray {
  const r = (north * Math.PI) / 180;

  return {
    origin: [x * Math.cos(r) - z * Math.sin(r), 50, x * Math.sin(r) + z * Math.cos(r)],
    direction: [0, -1, 0],
  };
}

function dragged(
  on: Scene,
  grip: Grip,
  height: number,
  [from, to]: readonly [Ray, Ray],
  target = BLOCK,
) {
  return drag(on, target, { grip, ray: from, height }, to);
}

test("a pitched block has width, depth, pitch, turn and move handles; a flat one no pitch", () => {
  expect(handles(scene(), BLOCK).map(({ grip }) => grip)).toEqual([
    "width",
    "depth",
    "pitch",
    "turn",
    "move",
  ]);

  const flat = scene([{ ...HOUSE, roof: { kind: "flat" } }]);

  expect(handles(flat, BLOCK).map(({ grip }) => grip)).not.toContain("pitch");
});

test("a tree has a radius and a move handle", () => {
  expect(handles(scene(), { kind: "obstacle", index: 0 }).map(({ grip }) => grip)).toEqual([
    "radius",
    "move",
  ]);
});

test("the width arrow follows the pointer and snaps to 10 cm", () => {
  const moved = dragged(scene(), "width", 1.5, [down(10.4, 4), down(12.43, 4)]);

  expect(moved?.value).toEqual([12]);
  expect(moved?.scene.blocks[0]).toEqual({ ...HOUSE, width: 12 });
});

test("the depth arrow runs along z; a scene turned to the east turns its axis with it", () => {
  const moved = dragged(scene([HOUSE], 90), "depth", 1.5, [down(5, 8.4, 90), down(5, 6.36, 90)]);

  expect(moved?.value).toEqual([6]);
});

test("a dragged wall snaps to a parallel block's edge within 25 cm", () => {
  const two = scene([HOUSE, { ...HOUSE, x: 22.1, width: 4 }]);
  const moved = dragged(two, "width", 1.5, [down(10.4, 4), down(22.33, 4)]);

  expect(moved?.value).toEqual([22.1]);
});

/** Level from the south, at height `up`. */
const toward = (up: number): Ray => ({ origin: [5, up, 50], direction: [0, 0, -1] });

test("the ridge handle drags the pitch, snapped to 5°", () => {
  const top = 3 + 4 * Math.tan((35 * Math.PI) / 180);
  const moved = dragged(scene(), "pitch", top, [toward(top), toward(7.1)]);

  expect(moved?.value).toEqual([45]);
  expect(moved?.scene.blocks[0]?.roof).toEqual({ kind: "gable", pitch: 45 });
});

test("the ring turns a block about its centre, snapped to 5°", () => {
  const moved = dragged(scene(), "turn", 0, [down(12, 4), down(5.3, 11)]);
  const block = moved?.scene.blocks[0];

  expect(moved?.value).toEqual([90]);
  expect(block?.rotation).toBe(90);
  expect(block?.x).toBeCloseTo(9);
  expect(block?.z).toBeCloseTo(-1);
});

test("the ring snaps to the compass axes and to other blocks' turns before the 5° steps", () => {
  const aside = (deg: number, north = 0): Ray => {
    const r = (deg * Math.PI) / 180;

    return down(5 + 7 * Math.cos(r), 4 + 7 * Math.sin(r), north);
  };

  // North 3°: a turn of 87° puts the walls on the compass.
  const compass = dragged(scene([HOUSE], 3), "turn", 0, [aside(0, 3), aside(88.6, 3)]);

  expect(compass?.value).toEqual([87]);

  const leaning = scene([HOUSE, { ...HOUSE, x: 30, rotation: 33 }]);

  expect(dragged(leaning, "turn", 0, [down(12, 4), aside(31.2)])?.value).toEqual([33]);
});

test("dragging the footprint moves it in 10 cm steps at the height it was grabbed", () => {
  const moved = dragged(scene(), "move", 5, [down(5, 4), down(8.04, 3.97)]);

  expect(moved?.value).toEqual([3, 0]);
  expect(moved?.scene.blocks[0]).toEqual({ ...HOUSE, x: 3, z: 0 });
});

test("a moved block snaps its edges to a neighbour's", () => {
  const two = scene([HOUSE, { ...HOUSE, x: 22.1, width: 4 }]);
  const moved = dragged(two, "move", 5, [down(5, 4), down(16.96, 4)]);

  expect(moved?.value).toEqual([12.1, 0]);
});

test("a tree's radius arrow grows it from its centre", () => {
  const tree: Target = { kind: "obstacle", index: 0 };
  const moved = dragged(scene(), "radius", 4, [down(-2.6, 10), down(-1.56, 10)], tree);

  expect(moved?.value).toEqual([3]);
  expect(moved?.scene.obstacles[0]).toMatchObject({ radius: 3, x: -5, z: 10 });
});

test("a block never drags narrower than a metre", () => {
  expect(dragged(scene(), "width", 1.5, [down(10.4, 4), down(-3, 4)])?.value).toEqual([1]);
});

test("a ray that never meets the drag's plane changes nothing", () => {
  const up: Ray = { origin: [5, 10, 4], direction: [0, 1, 0] };

  expect(dragged(scene(), "width", 1.5, [down(10.4, 4), up])).toBeNull();
});

test("a hedge's length arrow, depth arrow, ring and footprint drag it like a box", () => {
  const hedged: Scene = {
    ...scene(),
    obstacles: [{ kind: "hedge", x: 0, z: 20, length: 8, depth: 1, height: 1.8, rotation: 0 }],
  };

  const hedge: Target = { kind: "obstacle", index: 0 };

  expect(handles(hedged, hedge).map(({ grip }) => grip)).toEqual([
    "width",
    "depth",
    "turn",
    "move",
  ]);

  const longer = dragged(hedged, "width", 0.9, [down(8.4, 20.5), down(10.43, 20.5)], hedge);

  expect(longer?.scene.obstacles[0]).toMatchObject({ kind: "hedge", length: 10 });
});

test("a ground surface stretches, turns and moves on the ground", () => {
  const paved: Scene = {
    ...scene(),
    surfaces: [{ x: 0, z: 12, width: 4, depth: 6, rotation: 0, finish: "driveway" }],
  };

  const surface: Target = { kind: "surface", index: 0 };

  expect(handles(paved, surface).map(({ grip }) => grip)).toEqual([
    "width",
    "depth",
    "turn",
    "move",
  ]);

  const deeper = dragged(paved, "depth", 0, [down(2, 18.4), down(2, 20.38)], surface);

  expect(deeper?.scene.surfaces?.[0]).toMatchObject({ depth: 8, finish: "driveway" });
});
