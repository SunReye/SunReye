/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Box3, BoxGeometry, Mesh, Vector3 } from "three";
import type { BodyClass } from "../builder/pv.ts";
import { carBody, fitModel } from "./bodies.ts";
import type { Parked } from "./parked.ts";

function car(kind: BodyClass, forward: Parked["forward"] = [0, 1, 0]): Parked {
  return {
    device: 7,
    at: [4, -3, 0],
    forward,
    above: [4, -3, 2.5],
    length: 5,
    width: 2.5,
    body: { class: kind, colour: "#f2f2ee" },
    model: null,
    watts: null,
    soc: null,
  };
}

function size(kind: BodyClass, forward?: Parked["forward"]): Vector3 {
  const body = carBody(car(kind, forward));

  body.updateMatrixWorld(true);

  return new Box3().setFromObject(body).getSize(new Vector3());
}

test("a stylised body stands on the ground at its place's centre, inside the place", () => {
  const body = carBody(car("sedan"));

  body.updateMatrixWorld(true);

  const box = new Box3().setFromObject(body);
  const centre = box.getCenter(new Vector3());

  // Three.js's frame: x east, y up, z south.
  expect(box.min.y).toBeCloseTo(0, 6);
  expect(centre.x).toBeCloseTo(4, 1);
  expect(centre.z).toBeCloseTo(3, 1);
  expect(box.max.z - box.min.z).toBeLessThanOrEqual(5);
  expect(box.max.x - box.min.x).toBeLessThanOrEqual(2.5);
  expect(box.max.z - box.min.z).toBeGreaterThan(4);
});

test("a body turns its long side along the place's forward", () => {
  const east = size("sedan", [1, 0, 0]);

  expect(east.x).toBeGreaterThan(4);
  expect(east.z).toBeLessThanOrEqual(2.5);
});

test("each class has its own shape: a van stands taller than an SUV, an SUV than a sedan", () => {
  const [sedan, suv, van] = (["sedan", "suv", "van"] as const).map((kind) => size(kind).y);

  expect(suv).toBeGreaterThan(sedan ?? Infinity);
  expect(van).toBeGreaterThan(suv ?? Infinity);

  const classes = ["sedan", "hatchback", "suv", "van", "pickup"] as const;

  const outlines = classes.map((kind) =>
    size(kind)
      .toArray()
      .map((v) => v.toFixed(2))
      .join(),
  );

  expect(new Set(outlines).size).toBe(classes.length);
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
