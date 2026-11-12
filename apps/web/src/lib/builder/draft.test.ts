/// <reference types="bun" />
import { expect, test } from "bun:test";
import { lengthened, nextBlock, shortened, withRoof } from "./draft.ts";

test("the first block stands at the origin and the next beside the last, 2 m apart", () => {
  const first = nextBlock([]);

  expect([first.x, first.z]).toEqual([0, 0]);

  const second = nextBlock([{ ...first, x: 3, width: 12 }]);

  expect([second.x, second.z]).toEqual([17, 0]);
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
