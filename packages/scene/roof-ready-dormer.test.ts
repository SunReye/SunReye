// Ready dormers (ADR 20): each placed on a face in one click as the lines a person could have
// traced, then pulled up. Each test builds the dormer by clicks alone on a placed Satteldach, and
// the ready dormer must be that dormer.

import { expect, test } from "bun:test";
import {
  bent,
  dormers,
  markLine,
  placeDormer,
  pullDormer,
  readyDormers,
  setHeight,
  type DormerSize,
  type Scene,
} from "./index.js";
import { made, trace } from "./roof.harness.ts";
import { built, height, line, placed, point } from "./roof-ready.harness.ts";

// The Satteldach's ridge runs along x at z 4, eaves at 3 m, ridge at 7 m: its front face rises a
// metre each metre in from z 0, its back face from z 8.
const HOUSE = placed("satteldach");

/** Block 0's face whose outline holds (x, z) seen from above, of those standing on no other. */
function faceAt(scene: Scene, x: number, z: number): number {
  const faces = scene.blocks[0]?.freeForm?.faces ?? [];

  return faces.findIndex((face) => {
    let inside = false;

    for (const [k, [ax = 0, , az = 0]] of face.entries()) {
      const [bx = 0, , bz = 0] = face[(k + 1) % face.length] ?? [];

      if (az > z !== bz > z && x < ax + ((bx - ax) * (z - az)) / (bz - az)) inside = !inside;
    }

    return inside;
  });
}

const FRONT = faceAt(HOUSE, 5, 2);

/** 2 m wide and 2 m deep: on the front face from z 1, at 4 m, to z 3, at 6 m. */
const SIZE: DormerSize = { width: 2, depth: 2 };

/** A ready dormer placed on the front face, its middle at (5, 2). */
const ready = (id: string, size = SIZE) =>
  made(placeDormer(HOUSE, 0, FRONT, id, { x: 5, z: 2 }, size));

/** `scene`'s one dormer, pulled to its eaves and then its ridges, as the person does. */
function pulled(scene: Scene, eave: number, ridge?: number): Scene {
  const face = dormers(scene, 0)[0]?.faces[0] ?? -1;
  const eaves = made(pullDormer(scene, 0, face, "eave", eave));

  return ridge === undefined ? eaves : made(pullDormer(eaves, 0, face, "ridge", ridge));
}

test("the ready dormers are listed in order, each named in German and English", () => {
  expect(readyDormers.map((d) => d.id)).toEqual([
    "schleppgaube",
    "satteldachgaube",
    "walmgaube",
    "flachdachgaube",
    "zwerchhaus",
  ]);
  expect(readyDormers[0]).toEqual({ id: "schleppgaube", de: "Schleppgaube", en: "Shed dormer" });
});

test("a Schleppgaube is a rectangle, its front pulled up, its back on the face", () => {
  const clicked = pulled(trace(HOUSE, [4, 1], [6, 1], [6, 3], [4, 3], [4, 1]), 5);

  expect(height(clicked, 4, 1)).toBe(5);
  expect(height(clicked, 6, 3)).toBe(6);
  expect(bent(clicked, 0)).toEqual([]);
  expect(dormers(ready("schleppgaube"), 0)).toEqual([{ face: FRONT, faces: [2] }]);
  expect(built(ready("schleppgaube"))).toEqual(built(clicked));
});

test("a Flachdachgaube is a rectangle level with where its back meets the face", () => {
  const clicked = pulled(trace(HOUSE, [4, 1], [6, 1], [6, 3], [4, 3], [4, 1]), 6);

  expect(height(clicked, 4, 1)).toBe(6);
  expect(height(clicked, 6, 3)).toBe(6);
  expect(bent(clicked, 0)).toEqual([]);
  expect(dormers(ready("flachdachgaube"), 0)).toHaveLength(1);
  expect(built(ready("flachdachgaube"))).toEqual(built(clicked));
});

test("a Satteldachgaube is a ridge up its middle, its cheeks meeting the face where its eaves do", () => {
  const outline = trace(HOUSE, [4, 1], [5, 1], [6, 1], [6, 2], [5, 3], [4, 2], [4, 1]);
  const clicked = pulled(trace(outline, [5, 1], [5, 3]), 5, 6);

  expect(height(clicked, 5, 1)).toBe(6);
  expect(height(clicked, 4, 2)).toBe(5);
  expect(bent(clicked, 0)).toEqual([]);
  expect(dormers(ready("satteldachgaube"), 0)).toHaveLength(1);
  expect(built(ready("satteldachgaube"))).toEqual(built(clicked));
  expect(built(ready("satteldachgaube"))).toHaveLength(4);
});

test("a Walmgaube is a Satteldachgaube with a hip at its front", () => {
  const outline = trace(HOUSE, [4, 1], [6, 1], [6, 2], [5, 3], [4, 2], [4, 1]);
  const clicked = pulled(trace(trace(outline, [4, 1], [5, 2], [6, 1]), [5, 2], [5, 3]), 5, 6);

  expect(height(clicked, 5, 2)).toBe(6);
  expect(height(clicked, 6, 1)).toBe(5);
  expect(bent(clicked, 0)).toEqual([]);
  expect(dormers(ready("walmgaube"), 0)).toHaveLength(1);
  expect(built(ready("walmgaube"))).toEqual(built(clicked));
  expect(built(ready("walmgaube"))).toHaveLength(5);
});

test("a Zwerchhaus stands on the eave: its gable in the wall, its valleys up the face", () => {
  const traced = trace(trace(HOUSE, [4, 0], [5, 3], [6, 0]), [5, 0], [5, 3]);
  const left = made(markLine(traced, 0, line(traced, [4, 0], [5, 0]), "eave"));
  const right = made(markLine(left, 0, line(left, [5, 0], [6, 0]), "eave"));
  const gable = made(setHeight(right, 0, point(right, 5, 0), 6));
  const clicked = made(setHeight(gable, 0, point(gable, 5, 3), 6));

  expect(height(clicked, 4, 0)).toBe(3);
  expect(height(clicked, 5, 0)).toBe(6);
  expect(bent(clicked, 0)).toEqual([]);

  // Its middle at (5, 2), 3 m deep from the eave: its ridge meets the face at z 3.
  const zwerchhaus = made(
    placeDormer(HOUSE, 0, FRONT, "zwerchhaus", { x: 5, z: 2 }, { width: 2, depth: 3 }),
  );

  expect(built(zwerchhaus)).toEqual(built(clicked));
  expect(dormers(zwerchhaus, 0)).toEqual([]);
});

test("a dormer on the back face looks down its slope, toward +z", () => {
  const back = faceAt(HOUSE, 5, 6);
  const scene = made(placeDormer(HOUSE, 0, back, "schleppgaube", { x: 5, z: 6 }, SIZE));
  const clicked = pulled(trace(HOUSE, [4, 7], [6, 7], [6, 5], [4, 5], [4, 7]), 5);

  expect(height(scene, 4, 7)).toBe(5);
  expect(height(scene, 4, 5)).toBe(6);
  expect(built(scene)).toEqual(built(clicked));
});

test("a dormer's eave is given, or halfway between the face and its top", () => {
  expect(height(ready("schleppgaube", { ...SIZE, eave: 4.5 }), 4, 1)).toBe(4.5);
  expect(height(ready("schleppgaube"), 4, 1)).toBeCloseTo(5);
});

test("placing a dormer leaves the other faces in their places and says where each went", () => {
  const edited = placeDormer(HOUSE, 0, FRONT, "schleppgaube", { x: 5, z: 2 }, SIZE);

  expect("refused" in edited ? edited.refused : edited.faces).toEqual([0, 1]);
  expect("refused" in edited ? -2 : edited.block).toBe(0);
});

test("a dormer off its face, too high, on a flat face or unknown is refused", () => {
  const at = { x: 5, z: 2 };

  expect(placeDormer(HOUSE, 0, FRONT, "gaube", at, SIZE)).toEqual({ refused: "missing" });
  expect(placeDormer(HOUSE, 0, 9, "schleppgaube", at, SIZE)).toEqual({ refused: "missing" });
  expect(placeDormer(HOUSE, 1, FRONT, "schleppgaube", at, SIZE)).toEqual({ refused: "missing" });
  expect(placeDormer(HOUSE, 0, FRONT, "schleppgaube", at, { width: 0, depth: 2 })).toEqual({
    refused: "short",
  });
  expect(placeDormer(HOUSE, 0, FRONT, "schleppgaube", at, { ...SIZE, eave: 7 })).toEqual({
    refused: "short",
  });
  expect(placeDormer(HOUSE, 0, FRONT, "schleppgaube", { x: 9.5, z: 2 }, SIZE)).toEqual({
    refused: "crosses",
  });

  const flat = placed("flachdach");

  expect(placeDormer(flat, 0, 0, "schleppgaube", at, SIZE)).toEqual({ refused: "short" });
});
