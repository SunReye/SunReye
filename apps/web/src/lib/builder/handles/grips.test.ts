/// <reference types="bun" />
import { expect, test } from "bun:test";
import { nextBlock } from "../../../../../../packages/builder/src/builder/draft.ts";
import type { Block, Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import {
  drag,
  handles,
  turned,
  type Grip,
  type Ray,
  type Target,
} from "../../../../../../packages/builder/src/builder/handles/grips.ts";

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

const FENCE: Target = { kind: "fence", index: 0 };

/** A wooden fence from the house's front corner, 1.2 m high, turning once. */
const fenced = (north = 0): Scene => ({
  ...scene([HOUSE], north),
  fences: [
    {
      points: [
        { x: 0, z: 12 },
        { x: 8, z: 12 },
        { x: 8, z: 18 },
      ],
      height: 1.2,
      finish: "wood",
    },
  ],
});

test("a fence has a point handle on each of its points, at its height", () => {
  const found = handles(fenced(), FENCE);

  expect(found.map(({ grip, point }) => [grip, point])).toEqual([
    ["point", 0],
    ["point", 1],
    ["point", 2],
  ]);
  expect(found[1]?.at).toEqual([8, 1.2, 12]);
});

test("a fence point follows the pointer in 10 cm steps; the other points stay", () => {
  const moved = drag(
    fenced(90),
    FENCE,
    { grip: "point", point: 1, ray: down(8, 12, 90), height: 1.2 },
    down(9.04, 13.47, 90),
  );

  expect(moved?.value).toEqual([9, 13.5]);
  expect(moved?.scene.fences?.[0]?.points).toEqual([
    { x: 0, z: 12 },
    { x: 9, z: 13.5 },
    { x: 8, z: 18 },
  ]);
});

test("a fence point snaps to a block's edge within 25 cm", () => {
  const moved = drag(
    fenced(),
    FENCE,
    { grip: "point", point: 0, ray: down(0, 12, 0), height: 1.2 },
    down(10.18, 8.2),
  );

  expect(moved?.value).toEqual([10, 8]);
});

const PLACE: Target = { kind: "place", index: 0 };

/** A 2.5 m × 5 m car place in front of the house. */
const parked = (): Scene => ({
  ...scene(),
  carPlaces: [{ device: 3, x: 14, z: 12, width: 2.5, length: 5, rotation: 0, colour: "#c0ffee" }],
});

test("a car place has a turn and a move handle, on the ground", () => {
  const found = handles(parked(), PLACE);

  expect(found.map(({ grip }) => grip)).toEqual(["turn", "move"]);
  expect(found.every(({ at }) => at[1] === 0)).toBe(true);
});

test("a car place moves on the ground in 10 cm steps, keeping its size and colour", () => {
  const moved = dragged(parked(), "move", 0, [down(15, 14), down(17.04, 10.97)], PLACE);

  expect(moved?.value).toEqual([16, 9]);
  expect(moved?.scene.carPlaces).toEqual([
    { device: 3, x: 16, z: 9, width: 2.5, length: 5, rotation: 0, colour: "#c0ffee" },
  ]);
});

test("the ring turns a car place about its centre", () => {
  // From east of its centre (15.25, 14.5) to south of it: a quarter turn clockwise.
  const moved = dragged(parked(), "turn", 0, [down(19, 14.5), down(15.25, 18)], PLACE);
  const place = moved?.scene.carPlaces?.[0];

  expect(moved?.value).toEqual([90]);
  expect(place).toMatchObject({ rotation: 90, width: 2.5, length: 5 });
  // Its centre stays where it was.
  expect([place?.x, place?.z]).toEqual([17.75, 13.25]);
});

test("a dial turns a block about its centre by the degrees swept, snapped as the ring's turn is", () => {
  // 10 × 8 m at the origin: its centre stays at (5, 4).
  const quarter = turned(scene(), BLOCK, 88);

  expect(quarter?.value).toEqual([90]);
  expect(quarter?.scene.blocks[0]).toMatchObject({ rotation: 90, x: 9, z: -1 });
  // Against the clock, past zero.
  expect(turned(scene(), BLOCK, -42)?.value).toEqual([320]);
  // A fence has no turn.
  expect(turned(scene(), { kind: "fence", index: 0 }, 30)).toBeNull();
});
