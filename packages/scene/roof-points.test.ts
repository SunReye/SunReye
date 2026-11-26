// Editing what is traced (ADR 20 "Points"): a point dragged, one put into a line, one taken out,
// and a line dragged with the straight run it lies in. Faces follow each.

import { expect, test } from "bun:test";
import { moveLine, movePoint, removePoint, splitLine, type Scene } from "./index.js";
import { EMPTY, SQUARE, made, outlines, trace } from "./roof.harness.ts";

/** The traced point of block 0 at `[x, z]` seen from above. */
function pointAt(scene: Scene, [x, z]: readonly [number, number]): number {
  const points = scene.blocks[0]?.freeForm?.traced?.points ?? [];

  return points.findIndex(([px = 0, , pz = 0]) => Math.hypot(px - x, pz - z) < 1e-6);
}

/** The line of block 0 from `a` to `b`, either way round. */
function lineOf(scene: Scene, a: number, b: number): number {
  const lines = scene.blocks[0]?.freeForm?.traced?.lines ?? [];

  return lines.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));
}

const square = () => trace(EMPTY, ...SQUARE);

test("a point dragged moves alone, keeping its height; its face follows", () => {
  const scene = square();
  const moved = made(movePoint(scene, 0, pointAt(scene, [4, 4]), { x: 5, z: 5 }));

  expect(outlines(moved)).toEqual([
    [
      [0, 0],
      [0, 4],
      [5, 5],
      [4, 0],
    ],
  ]);
});

test("a point dragged across a line is refused, as lines would cross", () => {
  const scene = square();

  expect(movePoint(scene, 0, pointAt(scene, [0, 4]), { x: 6, z: 2 })).toEqual({
    refused: "crosses",
  });
});

test("a point put into a line splits it where it lies; taken out again, the line is whole", () => {
  const scene = square();
  const west = lineOf(scene, pointAt(scene, [0, 0]), pointAt(scene, [0, 4]));
  const split = made(splitLine(scene, 0, west, { x: 0.2, z: 2.5 }));

  expect(split.blocks[0]?.freeForm?.traced?.lines).toHaveLength(5);
  expect(outlines(split)[0]).toContainEqual([0, 2.5]);

  const joined = made(removePoint(split, 0, pointAt(split, [0, 2.5])));

  expect(joined.blocks[0]?.freeForm?.traced?.lines).toHaveLength(4);
  expect(outlines(joined)).toEqual(outlines(scene));
});

test("a corner taken out joins its two neighbours: a square loses a corner to a triangle", () => {
  const scene = square();
  const cut = made(removePoint(scene, 0, pointAt(scene, [4, 4])));

  expect(outlines(cut)).toEqual([
    [
      [0, 0],
      [0, 4],
      [4, 0],
    ],
  ]);
});

test("a line dragged takes the straight run it lies in, so a side split in two moves whole", () => {
  const scene = square();
  const west = lineOf(scene, pointAt(scene, [0, 0]), pointAt(scene, [0, 4]));
  const split = made(splitLine(scene, 0, west, { x: 0, z: 1 }));
  const piece = lineOf(split, pointAt(split, [0, 0]), pointAt(split, [0, 1]));
  const moved = made(moveLine(split, 0, piece, { x: -1, z: 0 }));

  expect(outlines(moved)).toEqual([
    [
      [-1, 0],
      [-1, 1],
      [-1, 4],
      [4, 4],
      [4, 0],
    ],
  ]);
});

test("a line dragged takes its run on through where an inner line meets it, which stretches", () => {
  // The south eave of a delivered roof, cut where an annex's line meets it.
  const scene = trace(square(), [0, 2], [4, 2]);
  const piece = lineOf(scene, pointAt(scene, [0, 0]), pointAt(scene, [0, 2]));
  const moved = made(moveLine(scene, 0, piece, { x: -1, z: 0 }));

  expect(outlines(moved)).toEqual([
    [
      [-1, 0],
      [-1, 2],
      [4, 2],
      [4, 0],
    ],
    [
      [-1, 2],
      [-1, 4],
      [4, 4],
      [4, 2],
    ],
  ]);
});
