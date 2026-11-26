// A ready roof stretched (ADR 20): a traced rectangle's side set to a length from the side across
// from it, its heights kept.
import { expect, test } from "bun:test";
import { rectangleOf, stretchBlock, type Block, type Scene } from "./index.js";

/** A 6 m × 4 m gable over a rectangle turned 90°: its first side runs south. */
const GABLE: Block = {
  x: 0,
  z: 0,
  width: 0,
  depth: 0,
  eave: 0,
  rotation: 0,
  roof: { kind: "flat" },
  freeForm: {
    footprint: [
      [10, 0],
      [10, 6],
      [6, 6],
      [6, 0],
    ],
    faces: [
      [
        [10, 3, 0],
        [10, 3, 6],
        [8, 5, 6],
        [8, 5, 0],
      ],
    ],
    traced: {
      points: [
        [10, 3, 0],
        [10, 3, 6],
        [6, 3, 6],
        [6, 3, 0],
        [8, 5, 0],
        [8, 5, 6],
      ],
      lines: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
      ],
      faces: [[0, 1, 5, 4]],
    },
  },
};

const scene = (block: Block): Scene => ({ north: 0, blocks: [block], obstacles: [] });

test("a traced rectangle has its first corner, its sides' ways and lengths", () => {
  expect(rectangleOf(GABLE)).toEqual({
    corner: [10, 0],
    axes: [
      [0, 1],
      [-1, 0],
    ],
    lengths: [6, 4],
  });
});

test("a footprint that is no rectangle has none", () => {
  const skew = {
    ...GABLE,
    freeForm: {
      ...GABLE.freeForm!,
      footprint: [
        [0, 0],
        [4, 0],
        [5, 3],
        [0, 3],
      ],
    },
  };

  const triangle = {
    ...GABLE,
    freeForm: {
      ...GABLE.freeForm!,
      footprint: [
        [0, 0],
        [4, 0],
        [0, 3],
      ],
    },
  };

  expect(rectangleOf(skew)).toBeNull();
  expect(rectangleOf(triangle)).toBeNull();
  expect(rectangleOf({ ...GABLE, freeForm: null })).toBeNull();
});

test("its first side set to 9 m moves the far side out, every point between in step, heights kept", () => {
  const form = stretchBlock(scene(GABLE), 0, 0, 9).blocks[0]?.freeForm;

  expect(form?.footprint).toEqual([
    [10, 0],
    [10, 9],
    [6, 9],
    [6, 0],
  ]);
  expect(form?.traced?.points).toEqual([
    [10, 3, 0],
    [10, 3, 9],
    [6, 3, 9],
    [6, 3, 0],
    [8, 5, 0],
    [8, 5, 9],
  ]);
  expect(form?.faces[0]).toEqual([
    [10, 3, 0],
    [10, 3, 9],
    [8, 5, 9],
    [8, 5, 0],
  ]);
});

test("its second side set to 3 m draws the far side in; the ridge keeps to the middle", () => {
  const points = stretchBlock(scene(GABLE), 0, 1, 3).blocks[0]?.freeForm?.traced?.points;

  expect(points).toEqual([
    [10, 3, 0],
    [10, 3, 6],
    [7, 3, 6],
    [7, 3, 0],
    [8.5, 5, 0],
    [8.5, 5, 6],
  ]);
});

test("no rectangle, no length or no such block leaves the scene as it is", () => {
  const start = scene(GABLE);

  expect(stretchBlock(start, 0, 0, 0)).toBe(start);
  expect(stretchBlock(start, 3, 0, 5)).toBe(start);
});
