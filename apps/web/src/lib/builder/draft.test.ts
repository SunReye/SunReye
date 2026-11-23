/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  lengthened,
  nextBlock,
  shortened,
  withRoof,
} from "../../../../../packages/builder/src/builder/draft.ts";

test("the first block stands at the origin and the next beside the last, 2 m apart", () => {
  const first = nextBlock([]);

  expect([first.x, first.z]).toEqual([0, 0]);

  const second = nextBlock([{ ...first, x: 3, width: 12 }]);

  expect([second.x, second.z]).toEqual([17, 0]);
});

test("a new block's roof reaches 0.5 m past its eaves and 0.3 m past its verges", () => {
  expect(nextBlock([]).overhang).toEqual({ eave: 0.5, verge: 0.3 });
});

test("a flat roof drops its pitch and a pitched roof keeps the one it had", () => {
  expect(withRoof({ kind: "gable", pitch: 30 }, "flat")).toEqual({ kind: "flat" });
  expect(withRoof({ kind: "gable", pitch: 30 }, "hip")).toEqual({ kind: "hip", pitch: 30 });
  expect(withRoof({ kind: "flat" }, "monoPitch")).toEqual({ kind: "monoPitch", pitch: 35 });
});

test("a fence grows by a point 3 m on along its last stretch, and gives one back down to two", () => {
  const fence = {
    points: [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 4 },
    ],
    height: 1.2,
    finish: "wood",
  } as const;

  expect(lengthened(fence).points.at(-1)).toEqual({ x: 4, z: 7 });
  expect(shortened(fence).points).toEqual([
    { x: 0, z: 0 },
    { x: 4, z: 0 },
  ]);
  expect(shortened(shortened(fence)).points).toHaveLength(2);
});

test("a new block stands beside a free-form block's footprint, not its unused rectangle", () => {
  const free = {
    ...nextBlock([]),
    width: 0,
    freeForm: {
      footprint: [
        [2, 1],
        [2, 5],
        [12, 5],
      ],
      faces: [],
    },
  };

  expect(nextBlock([free])).toMatchObject({ x: 14, z: 1 });
});
