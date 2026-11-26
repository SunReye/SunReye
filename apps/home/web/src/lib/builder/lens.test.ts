/// <reference types="bun" />
import { expect, test } from "bun:test";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { FOV } from "../../../../../../packages/builder/src/builder/camera.ts";
import { lensOf, fitLens } from "../../../../../../packages/builder/src/builder/lens.ts";

const target = new Vector3(2, 0, -3);

/** The plan's lens, parallel. */
function plan(): OrthographicCamera {
  const lens = lensOf("plan");

  if (!(lens instanceof OrthographicCamera)) throw new TypeError("a plan's lens is parallel");

  return lens;
}

test("a plan draws in parallel projection, the builder's own views in perspective", () => {
  expect(lensOf("plan")).toBeInstanceOf(OrthographicCamera);
  expect(lensOf("orbit")).toBeInstanceOf(PerspectiveCamera);
  expect(lensOf("model")).toBeInstanceOf(PerspectiveCamera);
});

test("a plan shows at its target as much as a perspective camera standing where it stands", () => {
  const lens = plan();

  lens.position.set(2, 40, -3);
  fitLens(lens, 2, target);

  const half = 40 * Math.tan(((FOV / 2) * Math.PI) / 180);

  expect(lens).toMatchObject({ top: half, bottom: -half, left: -2 * half, right: 2 * half });
});

test("a plan's zoom becomes its distance, so a view of it is where it stands and what it looks at", () => {
  const lens = plan();

  lens.position.set(2, 40, -3);
  lens.zoom = 2;
  fitLens(lens, 1, target);

  expect(lens.zoom).toBe(1);
  expect(lens.position.toArray()).toEqual([2, 20, -3]);
  expect(lens.top).toBeCloseTo(20 * Math.tan(((FOV / 2) * Math.PI) / 180), 9);
});

test("a perspective camera takes the canvas's fitLens alone", () => {
  const lens = lensOf("model");

  lens.position.set(10, 10, 10);
  fitLens(lens, 1.5, target);

  expect(lens).toMatchObject({ aspect: 1.5, zoom: 1 });
  expect(lens.position.toArray()).toEqual([10, 10, 10]);
});
