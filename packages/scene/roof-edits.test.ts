// Editing a traced roof (ADR 20): the faces follow the lines, and what stands on a face stays while
// the face does.

import { expect, test } from "bun:test";
import { moveLine, removeLine, type Scene } from "./index.js";
import { EMPTY, SQUARE, grid, made, outlines, trace } from "./roof.harness.ts";

test("moving a line changes its faces, and a module grid stays on a face that still exists", () => {
  const two = trace(trace(EMPTY, ...SQUARE), [4, 0], [8, 0], [8, 4], [4, 4]);

  const shared = (two.blocks[0]?.freeForm?.traced?.lines ?? []).findIndex(([a = -1, b = -1]) =>
    [a, b].every((p) => two.blocks[0]?.freeForm?.traced?.points[p]?.[0] === 4),
  );

  const placed: Scene = { ...two, grids: [grid(1)] };

  const moved = made(moveLine(placed, 0, shared, { x: 1, z: 0 }));

  expect(outlines(moved)).toEqual([
    [
      [0, 0],
      [0, 4],
      [5, 4],
      [5, 0],
    ],
    [
      [5, 0],
      [5, 4],
      [8, 4],
      [8, 0],
    ],
  ]);
  expect(moved.grids).toEqual([grid(1)]);
});

test("a point added on a face's edge leaves it the same face, its grid on it", () => {
  const square: Scene = { ...trace(EMPTY, ...SQUARE), grids: [grid(0)] };

  // A line from the middle of the left eave outward adds a corner to the face.
  const spur = trace(square, [0, 2], [-2, 2]);

  expect(outlines(spur)).toEqual([
    [
      [0, 0],
      [0, 2],
      [0, 4],
      [4, 4],
      [4, 0],
    ],
  ]);
  expect(spur.grids).toEqual([grid(0)]);
});

test("a line splitting a face into halves that keep two of its corners each ends it and its grid", () => {
  const square: Scene = { ...trace(EMPTY, ...SQUARE), grids: [grid(0)] };

  const split = trace(square, [0, 2], [4, 2]);

  expect(outlines(split).toSorted((a, b) => (a[0]?.[1] ?? 0) - (b[0]?.[1] ?? 0))).toEqual([
    [
      [0, 0],
      [0, 2],
      [4, 2],
      [4, 0],
    ],
    [
      [0, 2],
      [0, 4],
      [4, 4],
      [4, 2],
    ],
  ]);
  expect(split.grids).toEqual([]);
  expect(split.blocks[0]?.freeForm?.traced?.lines).toHaveLength(7);
});

test("of the halves a diagonal leaves, the larger keeps the face", () => {
  const kite = trace(EMPTY, [0, 0], [0, 4], [6, 6], [6, 0], [0, 0]);
  const placed: Scene = { ...kite, grids: [grid(0)] };

  const split = trace(placed, [0, 0], [6, 6]);

  expect(outlines(split)[0]).toEqual([
    [0, 0],
    [6, 6],
    [6, 0],
  ]);
  expect(split.grids).toEqual([grid(0)]);
});

test("removing a shared line merges its faces; the merged-away face's grid goes, later ones move up", () => {
  // Three squares in a row: faces 0, 1 and 2, each with a grid.
  const three = trace(
    trace(trace(EMPTY, ...SQUARE), [4, 0], [8, 0], [8, 4], [4, 4]),
    [8, 0],
    [12, 0],
    [12, 4],
    [8, 4],
  );

  const lines = three.blocks[0]?.freeForm?.traced?.lines ?? [];
  const points = three.blocks[0]?.freeForm?.traced?.points ?? [];
  const between = lines.findIndex(([a = -1, b = -1]) => [a, b].every((p) => points[p]?.[0] === 4));
  const placed: Scene = { ...three, grids: [grid(0), grid(1), grid(2)] };

  const merged = made(removeLine(placed, 0, between));

  expect(outlines(merged)).toEqual([
    [
      [0, 0],
      [0, 4],
      [4, 4],
      [8, 4],
      [8, 0],
      [4, 0],
    ],
    [
      [8, 0],
      [8, 4],
      [12, 4],
      [12, 0],
    ],
  ]);
  expect(merged.grids).toEqual([grid(0), grid(1)]);
});

test("removing a block's last line removes the block, and later blocks' grids move up", () => {
  const two = trace(trace(EMPTY, [0, 0], [0, 4]), ...SQUARE.map(([x, z]) => [x + 10, z] as const));
  const placed: Scene = { ...two, grids: [{ ...grid(0), block: 1 }] };

  const left = made(removeLine(placed, 0, 0));

  expect(left.blocks).toHaveLength(1);
  expect(left.grids).toEqual([grid(0)]);
});

test("a move that makes two lines cross is refused", () => {
  const scene = trace(EMPTY, [0, 0], [0, 4], [4, 4], [4, 0], [2, 0]);

  expect(moveLine(scene, 0, 3, { x: -3, z: 0 })).toEqual({ refused: "crosses" });
});
