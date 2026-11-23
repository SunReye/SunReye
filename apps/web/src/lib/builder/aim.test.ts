/// <reference types="bun" />
import { expect, test } from "bun:test";
import { PerspectiveCamera } from "three";
import { onPlane } from "../../../../../packages/builder/src/builder/aim.ts";
import type { RoofFace } from "../../../../../packages/builder/src/builder/pv.ts";

/** A face pitched 45° to the south, its lower left corner 3 m up at the origin. */
const ROOF: RoofFace = {
  block: 0,
  face: 0,
  tilt: 45,
  azimuth: 0,
  outline: [
    [0, 0],
    [10, 0],
    [10, 4],
    [0, 4],
  ],
  origin: [0, 0, 3],
  across: [1, 0, 0],
  up: [0, Math.SQRT1_2, Math.SQRT1_2],
};

/** A camera 20 m south of the house and 5 m up, looking level to the north. */
function camera(): PerspectiveCamera {
  const south = new PerspectiveCamera(40, 1, 0.1, 5000);

  // three.js: x east, y up, z south.
  south.position.set(5, 5, 20);
  south.lookAt(5, 5, 0);
  south.updateMatrixWorld();

  return south;
}

test("a pointer's ray meets a roof face's plane where the face rises to the ray's height", () => {
  const met = onPlane(camera(), [0, 0], ROOF);

  // Level at 5 m up: the 45° face is 2 m over its eave 2 m north of it.
  expect(met?.map((value) => Math.round(value * 1000) / 1000)).toEqual([5, 2, 5]);
});

test("a pointer past the face's edge still meets its plane; a ray along the plane meets nothing", () => {
  const past = onPlane(camera(), [-0.9, 0], ROOF);

  expect(past?.[0]).toBeLessThan(0);
  expect(onPlane(camera(), [0, 0], { ...ROOF, up: [0, 1, 0] })).toBeNull();
});
