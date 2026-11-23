/// <reference types="bun" />
import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Group,
} from "three";
import { carBody, fitModel, loadCar } from "../../../../../packages/builder/src/cars/bodies.ts";
import type { Parked } from "../../../../../packages/builder/src/cars/parked.ts";

const SHIPPED = new URL(import.meta.resolve("../../../../../packages/builder/src/cars/car.glb"));

const loaded = loadCar(SHIPPED.href);

function car(colour: string, forward: Parked["forward"] = [0, 1, 0]): Parked {
  return {
    device: 7,
    at: [4, -3, 0],
    forward,
    above: [4, -3, 2.5],
    length: 5,
    width: 2.5,
    colour,
    model: null,
    watts: null,
    soc: null,
  };
}

async function placed(colour: string, forward?: Parked["forward"]): Promise<Group> {
  const body = carBody(car(colour, forward), await loaded);

  body.updateMatrixWorld(true);

  return body;
}

/** The triangles of `object`'s meshes, and whether each has normals. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js walks a live group.
function triangles(object: Group) {
  let count = 0;
  let normals = true;

  for (const mesh of object.getObjectsByProperty("isMesh", true)) {
    const geometry: unknown = mesh instanceof Mesh ? mesh.geometry : null;

    if (geometry instanceof BufferGeometry) {
      const position: unknown = geometry.getAttribute("position");
      const listed = position instanceof BufferAttribute ? position.count : 0;
      const corners = geometry.index?.count ?? listed;

      count += corners / 3;
      normals &&= geometry.getAttribute("normal") !== undefined;
    }
  }

  return { count, normals };
}

/** The colours of `object`'s own paint. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js walks a live group.
function paints(object: Group): Set<string> {
  const found = new Set<string>();

  for (const mesh of object.getObjectsByProperty("isMesh", true)) {
    if (
      mesh instanceof Mesh &&
      mesh.material instanceof MeshStandardMaterial &&
      mesh.material.userData["paint"] === true
    ) {
      found.add(`#${mesh.material.color.getHexString()}`);
    }
  }

  return found;
}

test("the shipped body is under 50 KB, about 4,000 triangles, its normals rebuilt on load", async () => {
  const { size } = await stat(SHIPPED);
  const { count, normals } = triangles(await loaded);

  expect(size).toBeLessThan(50_000);
  expect(count).toBeGreaterThan(3000);
  expect(count).toBeLessThan(5000);
  expect(normals).toBe(true);
});

test("the default body stands on the ground at its place's centre, inside the place", async () => {
  const box = new Box3().setFromObject(await placed("#f2f2ee"));
  const centre = box.getCenter(new Vector3());

  // Three.js's frame: x east, y up, z south.
  expect(box.min.y).toBeCloseTo(0, 2);
  expect(centre.x).toBeCloseTo(4, 1);
  expect(centre.z).toBeCloseTo(3, 1);
  expect(box.max.z - box.min.z).toBeLessThanOrEqual(5);
  expect(box.max.x - box.min.x).toBeLessThanOrEqual(2.5);
  expect(box.max.z - box.min.z).toBeGreaterThan(4);
});

test("the default body turns its long side along the place's forward", async () => {
  const east = new Box3().setFromObject(await placed("#f2f2ee", [1, 0, 0])).getSize(new Vector3());

  expect(east.x).toBeGreaterThan(4);
  expect(east.z).toBeLessThanOrEqual(2.5);
});

test("each car is painted in its place's colour, the next car's paint its own", async () => {
  const red = await placed("#c0392b");
  const blue = await placed("#1f3a5f");

  expect(paints(red)).toEqual(new Set(["#c0392b"]));
  expect(paints(blue)).toEqual(new Set(["#1f3a5f"]));
});

test("an uploaded model is scaled to the place's length and set on the ground", () => {
  // 10 m long along x, its floor 3 m under its origin, centred off to one side.
  const model = new Mesh(new BoxGeometry(10, 3, 4));

  model.position.set(20, -1.5, 7);

  const fitted = fitModel(model, 5);

  fitted.updateMatrixWorld(true);

  const box = new Box3().setFromObject(fitted);
  const fit = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());

  expect([fit.x, fit.y, fit.z].map((v) => Number(v.toFixed(6)))).toEqual([5, 1.5, 2]);
  expect(box.min.y).toBeCloseTo(0, 6);
  expect([centre.x, centre.z].map((v) => Number(v.toFixed(6)))).toEqual([0, 0]);
});
