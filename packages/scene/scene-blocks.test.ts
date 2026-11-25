// A block moved or removed with what stands on it (ADR 20): one copy for every consumer.
import { expect, test } from "bun:test";
import { moveBlock, removeBlock, type Scene } from "./index.js";

const traced = {
  x: 0,
  z: 0,
  width: 0,
  depth: 0,
  eave: 0,
  rotation: 0,
  roof: { kind: "flat" as const },
  freeForm: {
    footprint: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
    faces: [
      [
        [0, 3, 0],
        [4, 3, 0],
        [4, 3, 4],
      ],
    ],
    traced: {
      points: [
        [0, 3, 0],
        [4, 3, 0],
        [4, 3, 4],
      ],
      lines: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
      faces: [[0, 1, 2]],
    },
  },
};

const gable = {
  x: 20,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable" as const, pitch: 35 },
};

const on = (block: number) => ({ block, face: 0 });

const chimney = (block: number) => ({
  ...on(block),
  across: 1,
  up: 1,
  width: 0.5,
  depth: 0.5,
  height: 1,
});

const roofWindow = (block: number) => ({
  ...on(block),
  across: 1,
  up: 1,
  width: 0.78,
  length: 1.18,
});

const scene: Scene = {
  north: 0,
  obstacles: [],
  blocks: [traced, gable, { ...gable, x: 40 }],
  chimneys: [chimney(0), chimney(2)],
  roofWindows: [roofWindow(1)],
  faceDetails: [
    { ...on(0), covering: "tiles", pitchConfirmed: false },
    { ...on(2), covering: "slate", pitchConfirmed: true },
  ],
  grids: [{ ...on(1), moduleType: 0, setback: 0.3, landscape: false, modules: [] }],
};

test("a traced block moves with its footprint, faces and points; a parametric one by its corner", () => {
  const moved = moveBlock(scene, 0, [2, -1]);
  const block = moved.blocks[0];

  expect(block?.x).toBe(2);
  expect(block?.z).toBe(-1);
  expect(block?.freeForm?.footprint).toEqual([
    [2, -1],
    [6, -1],
    [6, 3],
  ]);
  expect(block?.freeForm?.faces[0]).toEqual([
    [2, 3, -1],
    [6, 3, -1],
    [6, 3, 3],
  ]);
  expect(block?.freeForm?.traced?.points[2]).toEqual([6, 3, 3]);
  expect(block?.freeForm?.traced?.lines).toEqual(traced.freeForm.traced.lines);
  expect(moveBlock(scene, 1, [1, 1]).blocks[1]).toEqual({ ...gable, x: 21, z: 1 });
});

test("what stands on a moved block rides along: it is placed in its face", () => {
  const moved = moveBlock(scene, 0, [2, -1]);

  expect(moved.chimneys).toEqual(scene.chimneys);
  expect(moved.blocks[1]).toBe(scene.blocks[1]);
});

test("no such block: the scene as it was", () => {
  expect(moveBlock(scene, 7, [1, 1])).toBe(scene);
  expect(removeBlock(scene, 7)).toBe(scene);
});

test("a removed block takes what stands on it; later blocks' follow them down", () => {
  const removed = removeBlock(scene, 0);

  expect(removed.blocks).toEqual([gable, { ...gable, x: 40 }]);
  expect(removed.chimneys).toEqual([chimney(1)]);
  expect(removed.roofWindows).toEqual([roofWindow(0)]);
  expect(removed.faceDetails).toEqual([{ ...on(1), covering: "slate", pitchConfirmed: true }]);
  expect(removed.grids?.map(({ block }) => block)).toEqual([0]);
});

test("the last block may go: the scene keeps no house", () => {
  const alone: Scene = {
    ...scene,
    blocks: [traced],
    chimneys: [],
    roofWindows: [],
    faceDetails: [],
  };

  expect(removeBlock(alone, 0).blocks).toEqual([]);
});
