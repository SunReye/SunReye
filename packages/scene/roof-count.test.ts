// A block's roof faces, as the pv crate lists them (ADR 20); the engine agrees in
// apps/home/web/src/lib/builder/face-count.test.ts.
import { expect, test } from "bun:test";
import { faceCount, type Scene } from "./index.js";

const scene: Scene = {
  north: 0,
  obstacles: [],
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
    {
      x: 0,
      z: 0,
      width: 0,
      depth: 0,
      eave: 0,
      rotation: 0,
      roof: { kind: "flat" },
      freeForm: {
        footprint: [
          [0, 0],
          [4, 0],
          [4, 4],
        ],
        faces: [
          [
            [0, 3, 0],
            [4, 3, 0],
            [4, 3, 4],
          ],
        ],
      },
    },
  ],
};

test("a gable has two faces, a free-form block its own, a missing block none", () => {
  expect([0, 1, 2].map((block) => faceCount(scene, block))).toEqual([2, 1, 0]);
});
