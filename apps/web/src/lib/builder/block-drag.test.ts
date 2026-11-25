/// <reference types="bun" />
import { expect, test } from "bun:test";
import { drag } from "../../../../../packages/builder/src/builder/handles/grips.ts";
import type { Ray } from "../../../../../packages/builder/src/builder/handles/frame.ts";
import type { Scene } from "../../../../../packages/builder/src/builder/pv.ts";

/** A traced flat roof 3 m up, 4 m square, its corner at the origin. */
const scene: Scene = {
  north: 0,
  obstacles: [],
  grids: [],
  blocks: [
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
          [0, 4],
        ],
        faces: [
          [
            [0, 3, 0],
            [4, 3, 0],
            [4, 3, 4],
            [0, 3, 4],
          ],
        ],
      },
    },
  ],
};

/** Straight down onto x, z in three.js's frame. */
const down = (x: number, z: number): Ray => ({ origin: [x, 50, z], direction: [0, -1, 0] });

test("a traced block dragged by its roof moves whole, the shift snapped to 10 cm", () => {
  const grab = { grip: "move" as const, ray: down(1, 1), height: 3 };

  const dragged = drag(scene, { kind: "block", index: 0 }, grab, down(3.04, 0.47));

  expect(dragged?.value).toEqual([2, -0.5]);
  expect(dragged?.scene.blocks[0]?.freeForm?.footprint[2]).toEqual([6, 3.5]);
});
