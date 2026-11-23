/// <reference types="bun" />
// A click on a roof answers its block and face (ADR 25 "A roof face, in and out"): the face the
// struck point lies on, by the crate's roof faces.
import { expect, test } from "bun:test";
import type { RoofFace } from "@sunreye/pv-wasm";
import { roofFaceAt } from "../../../../../packages/builder/src/builder/roof-face.ts";

/** A gable roof 10 m long, its eaves at 3 m and ridge at 6 m, 4 m in from each eave. */
const SOUTH: RoofFace = {
  block: 0,
  face: 1,
  tilt: 36.87,
  azimuth: 0,
  outline: [
    [0, 0],
    [10, 0],
    [10, 5],
    [0, 5],
  ],
  origin: [0, -4, 3],
  across: [1, 0, 0],
  up: [0, 0.8, 0.6],
};

const NORTH: RoofFace = {
  ...SOUTH,
  face: 2,
  azimuth: 180,
  origin: [10, 4, 3],
  across: [-1, 0, 0],
  up: [0, -0.8, 0.6],
};

const ROOFS = [SOUTH, NORTH];

test("a point on a roof face answers that face's block and face", () => {
  // Halfway up the south face: 2 m north of its eave and 1.5 m higher.
  expect(roofFaceAt(ROOFS, [5, -2, 4.5])).toEqual({ block: 0, face: 1 });
  expect(roofFaceAt(ROOFS, [5, 2, 4.5])).toEqual({ block: 0, face: 2 });
});

test("a point off every roof face, beside it or under it, answers none", () => {
  expect(roofFaceAt(ROOFS, [12, -2, 4.5])).toBeNull();
  expect(roofFaceAt(ROOFS, [5, -2, 1])).toBeNull();
  expect(roofFaceAt([], [5, -2, 4.5])).toBeNull();
});
