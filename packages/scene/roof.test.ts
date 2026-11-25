// Tracing a roof (ADR 20): each click joins the last and snaps, and every closed loop of lines is
// a face by itself.

import { expect, test } from "bun:test";
import { addLine, loops, snap, type End } from "./index.js";
import { EMPTY, REACH, SQUARE, made, outlines, trace } from "./roof.harness.ts";

test("four lines clicked into a loop make one face, counter-clockwise seen from above", () => {
  const scene = trace(EMPTY, ...SQUARE);

  // Counter-clockwise seen from above, y up: along +z first, then +x (the pv crate's front).
  expect(outlines(scene)).toEqual([
    [
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 0],
    ],
  ]);
  expect(scene.blocks[0]?.freeForm?.traced?.lines).toHaveLength(4);
  expect(scene.blocks[0]?.freeForm?.footprint).toHaveLength(4);
});

test("two loops sharing a line make two faces", () => {
  const scene = trace(trace(EMPTY, ...SQUARE), [4, 0], [8, 0], [8, 4], [4, 4]);

  expect(outlines(scene)).toEqual([
    [
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 0],
    ],
    [
      [4, 0],
      [4, 4],
      [8, 4],
      [8, 0],
    ],
  ]);
  expect(scene.blocks).toHaveLength(1);
  expect(scene.blocks[0]?.freeForm?.footprint).toHaveLength(6);
});

test("no edge is added that nobody drew: three sides of a square make no face", () => {
  const scene = trace(EMPTY, [0, 0], [0, 4], [4, 4], [4, 0]);

  expect(outlines(scene)).toEqual([]);
  expect(scene.blocks[0]?.freeForm?.traced?.lines).toHaveLength(3);
  expect(scene.blocks[0]?.freeForm?.footprint).toEqual([]);
});

test("a click near an existing point snaps to it and names the snap", () => {
  const scene = trace(EMPTY, [0, 0], [0, 4]);

  expect(snap(scene, { x: 0.1, z: 3.85 }, REACH)).toEqual({
    kind: "point",
    block: 0,
    point: 1,
    at: [0, 0, 4],
  });
});

test("a click near a line snaps onto it, and one away from all is free", () => {
  const scene = trace(EMPTY, [0, 0], [0, 4]);

  expect(snap(scene, { x: 0.2, z: 1.5 }, REACH)).toEqual({
    kind: "line",
    block: 0,
    line: 0,
    at: [0, 0, 1.5],
  });
  expect(snap(scene, { x: 2, z: 2 }, REACH)).toEqual({ kind: "free", at: [2, 0, 2] });
});

test("closing a loop on a click near its first point snaps and makes the face", () => {
  const scene = trace(EMPTY, [0, 0], [0, 4], [4, 4], [4, 0], [0.2, -0.1]);

  expect(outlines(scene)).toHaveLength(1);
  expect(scene.blocks[0]?.freeForm?.traced?.points).toHaveLength(4);
});

test("a line crossing another where no click was splits both there, adding a point and no line", () => {
  const cross = trace(trace(EMPTY, [0, 2], [4, 2]), [2, 0], [2, 4]);

  expect(cross.blocks[0]?.freeForm?.traced?.lines).toHaveLength(4);
  expect(cross.blocks[0]?.freeForm?.traced?.points).toContainEqual([2, 0, 2]);
});

test("a line away from every traced roof starts another block; one joining two roofs is refused", () => {
  const two = trace(trace(EMPTY, [0, 0], [0, 4]), [10, 0], [10, 4]);

  expect(two.blocks).toHaveLength(2);
  expect(addLine(two, { block: 0, point: 1 }, { block: 1, point: 1 }, REACH)).toEqual({
    refused: "joins",
  });
});

test("a line of no length is refused", () => {
  const one = trace(EMPTY, [0, 0], [0, 4]);

  expect(addLine(one, { block: 0, point: 1 }, { x: 0.1, z: 4 }, REACH)).toEqual({
    refused: "short",
  });
});

test("a click on a surface lands at its height and sets it; one on plain ground leaves it unset", () => {
  const scene = made(addLine(EMPTY, { x: 0, z: 0, height: 3 }, { x: 0, z: 4 }, REACH));
  const traced = scene.blocks[0]?.freeForm?.traced;

  expect(traced?.points).toEqual([
    [0, 3, 0],
    [0, 0, 4],
  ]);
  expect(traced?.set).toEqual([0]);
});

test("a loop is found by itself, and a line that ends nowhere closes none", () => {
  const points = [
    [0, 0, 0],
    [0, 0, 4],
    [4, 0, 4],
    [4, 0, 0],
    [2, 0, 2],
  ];

  const lines = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [0, 4],
  ];

  // Counter-clockwise seen from above: along +z first, then +x.
  expect(loops(points, lines)).toEqual([[1, 2, 3, 0]]);
});

test("a line traced into a new roof starts a block even where it shares a wall, and the next lines join it", () => {
  const house = trace(EMPTY, ...SQUARE);
  const first = addLine(house, { block: 0, point: 2 }, { x: 7, z: 4 }, REACH, "new");

  if ("refused" in first) throw new Error(first.refused);

  expect(first.block).toBe(1);

  // Round the garage and back along the house's wall: each line stays the garage's.
  let scene = first.scene;
  let from: End = { block: 1, point: first.to };

  for (const [x, z] of [
    [7, 0],
    [4, 0],
    [4, 4],
  ] as const) {
    const added = addLine(scene, from, { x, z }, REACH, 1);

    if ("refused" in added) throw new Error(added.refused);
    scene = added.scene;
    from = { block: 1, point: added.to };
  }

  expect(scene.blocks).toHaveLength(2);
  expect(outlines(scene, 0)).toEqual(outlines(house, 0));
  expect(outlines(scene, 1)).toEqual([
    [
      [4, 0],
      [4, 4],
      [7, 4],
      [7, 0],
    ],
  ]);
});

test("a line traced into a block that is not a traced roof is refused", () => {
  expect(addLine(EMPTY, { x: 0, z: 0 }, { x: 0, z: 4 }, REACH, 0)).toEqual({ refused: "missing" });
});
