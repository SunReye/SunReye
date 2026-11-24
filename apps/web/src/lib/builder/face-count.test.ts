/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import {
  addLine,
  faceCount,
  placeRoof,
  readyRoofs,
  type Block,
  type Edited,
  type End,
  type Scene,
} from "@sunreye/scene";

// `@sunreye/scene` counts a block's roof faces as the pv crate lists them (ADR 20), parametric or
// traced, so a consumer checks a face index without the engine.

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** The scene an edit made. */
function made(edited: Edited): Scene {
  if ("refused" in edited) throw new Error(edited.refused);

  return edited.scene;
}

/** The roof faces the engine lists for each block of `scene`. */
const engine = (scene: Scene): number[] =>
  scene.blocks.map((_, b) => pv.modules(scene, {}).roofs.filter(({ block }) => block === b).length);

/** What `faceCount` says for each block of `scene`. */
const counted = (scene: Scene): number[] => scene.blocks.map((_, b) => faceCount(scene, b));

const box = (roof: Block["roof"], width = 10, depth = 8): Block => ({
  x: 0,
  z: 0,
  width,
  depth,
  eave: 3,
  rotation: 0,
  roof,
});

test("a parametric block has the faces its roof does: flat and mono-pitch one, gable two, hip four", () => {
  const scene: Scene = {
    north: 0,
    obstacles: [],
    blocks: [
      box({ kind: "flat" }),
      box({ kind: "monoPitch", pitch: 10 }),
      box({ kind: "gable", pitch: 35 }),
      box({ kind: "hip", pitch: 30 }),
      box({ kind: "hip", pitch: 30 }, 8, 8),
    ],
  };

  expect(counted(scene)).toEqual([1, 1, 2, 4, 4]);
  expect(counted(scene)).toEqual(engine(scene));
});

test("every ready roof, and a dormer traced on one, has the faces the engine lists", () => {
  const empty: Scene = { north: 0, obstacles: [], blocks: [] };
  const size = { width: 10, depth: 8, eave: 3, ridge: 7 };

  for (const { id } of readyRoofs) {
    const scene = made(placeRoof(empty, id, { x: 0, z: 0 }, size));

    expect([id, ...counted(scene)]).toEqual([id, ...engine(scene)]);
  }

  // A 2 m square traced inside a flat roof's face: a dormer of one face.
  const flat = made(placeRoof(empty, "flachdach", { x: 0, z: 0 }, size));
  let from: End = { x: 4, z: 3 };
  let dormered = flat;

  for (const to of [
    { x: 6, z: 3 },
    { x: 6, z: 5 },
    { x: 4, z: 5 },
    { x: 4, z: 3 },
  ]) {
    const edited = addLine(dormered, from, to, 0.02);

    dormered = made(edited);

    if (!("refused" in edited)) from = { block: edited.block, point: edited.to };
  }

  expect(faceCount(dormered, 0)).toBe(faceCount(flat, 0) + 1);
  expect(counted(dormered)).toEqual(engine(dormered));
});

test("a block the scene has not has no faces", () => {
  expect(faceCount({ north: 0, obstacles: [], blocks: [] }, 0)).toBe(0);
});
