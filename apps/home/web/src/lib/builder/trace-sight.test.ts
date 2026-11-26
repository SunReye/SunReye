/// <reference types="bun" />
import { expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh, OrthographicCamera, PerspectiveCamera } from "three";
import { sight } from "../../../../../../packages/builder/src/builder/trace-sight.ts";

// Whether the house hides a traced point from the camera (ADR 20 "Points"): seen in 3D, one behind
// the roof is neither drawn plain nor grabbed; a plan, seen straight down, hides none.

/** A 4 m block standing between the camera, 20 m south and 10 m up, and the scene's origin. */
function blocked(): Group {
  const house = new Group();
  const block = new Mesh(new BoxGeometry(4, 4, 4));

  block.position.set(0, 2, 6);
  house.add(block);
  house.updateMatrixWorld(true);

  return house;
}

/** A camera at `[0, 10, 20]` looking at the origin. */
function looking<C extends PerspectiveCamera | OrthographicCamera>(camera: C): C {
  camera.position.set(0, 10, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  return camera;
}

test("seen in 3D, a point behind the house is hidden and one beside it is seen", () => {
  const seen = sight(looking(new PerspectiveCamera(40, 1, 0.1, 100)), blocked());

  expect(seen([0, 0, 0], 0)).toBe(false);
  expect(seen([8, 0, 0], 0)).toBe(true);
});

test("a point on the house's near side is seen, as its own surface hides nothing", () => {
  const seen = sight(looking(new PerspectiveCamera(40, 1, 0.1, 100)), blocked());

  expect(seen([0, 4, 8], 0)).toBe(true);
});

test("a plan, seen straight down, hides no point", () => {
  const seen = sight(looking(new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)), blocked());

  expect(seen([0, 0, 0], 0)).toBe(true);
});
