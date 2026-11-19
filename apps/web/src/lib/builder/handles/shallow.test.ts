/// <reference types="bun" />
import { expect, test } from "bun:test";
import { nextBlock } from "../draft.ts";
import type { Scene } from "../pv.ts";
import { drag, type Ray, type Target } from "./grips.ts";

const BLOCK: Target = { kind: "block", index: 0 };

const scene = (): Scene => ({ north: 0, blocks: [nextBlock([])], obstacles: [] });

/** From a camera level with three.js's `eye`, as the north, east, south and west views stand,
 * through `point`. */
function through(
  eye: readonly [number, number, number],
  point: readonly [number, number, number],
): Ray {
  const way = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]] as const;
  const length = Math.hypot(...way);

  return { origin: eye, direction: [way[0] / length, way[1] / length, way[2] / length] };
}

test("seen level from the south, the pointer's way up the screen pushes a block as far away", () => {
  // The south wall's middle, 1.5 m up, from 25 m south of it at the same height.
  const eye = [5, 1.5, 33] as const;
  const wall = [5, 1.5, 8] as const;
  const grab = { grip: "move", ray: through(eye, wall), height: 1.5, at: wall } as const;

  const aside = drag(scene(), BLOCK, grab, through(eye, [6, 1.5, 8]));
  const up = drag(scene(), BLOCK, grab, through(eye, [5, 2.5, 8]));
  const downward = drag(scene(), BLOCK, grab, through(eye, [5, 1, 8]));

  expect(aside?.value).toEqual([1, 0]);
  expect(up?.value).toEqual([0, -1]);
  expect(downward?.value).toEqual([0, 0.5]);
});

test("seen from 20° up, a block still follows the pointer on the ground", () => {
  const eye = [5, 12, 30] as const;
  const grab = { grip: "move", ray: through(eye, [5, 0, 8]), height: 0, at: [5, 0, 8] } as const;

  expect(drag(scene(), BLOCK, grab, through(eye, [5, 0, 6]))?.value).toEqual([0, -2]);
});
