/// <reference types="bun" />
import { expect, test } from "bun:test";
import { nextBlock } from "./draft.ts";
import { parent, picked } from "./levels.ts";
import type { Scene } from "./pv.ts";

const HOUSE = nextBlock([]);

/** A 10 m × 8 m house at the origin, a tree in front and a box beside it. */
const SCENE: Scene = {
  north: 0,
  blocks: [HOUSE, { ...HOUSE, x: 20, width: 4, depth: 4 }],
  obstacles: [
    { kind: "tree", x: -5, z: 10, radius: 2, height: 8 },
    { kind: "box", x: 0, z: 12, width: 4, depth: 1, height: 2, rotation: 0 },
  ],
  grids: [{ block: 0, face: 1, moduleType: 7, landscape: false, setback: 0.3, modules: [] }],
};

test("a point on a roof drills to its block; east and north are the scene's x and −z", () => {
  expect(picked(SCENE, { kind: "point", point: [5, -4, 5] })).toEqual({ kind: "block", index: 0 });
  expect(picked(SCENE, { kind: "point", point: [22, -2, 3] })).toEqual({ kind: "block", index: 1 });
});

test("a point on a roof's overhang, past the walls, drills to its block", () => {
  // The new house's roof reaches 0.5 m past its front wall at z 8.
  expect(picked(SCENE, { kind: "point", point: [5, -8.4, 2.8] })).toEqual({
    kind: "block",
    index: 0,
  });
  expect(picked(SCENE, { kind: "point", point: [5, -8.7, 2.8] })).toBeNull();
});

test("the compass turns the scene: the same block answers where north puts it", () => {
  // Turned 90° clockwise, the house's centre (5, 4) lies 4 m west and 5 m north of the origin.
  expect(picked({ ...SCENE, north: 90 }, { kind: "point", point: [-4, -5, 5] })).toEqual({
    kind: "block",
    index: 0,
  });
  expect(picked({ ...SCENE, north: 90 }, { kind: "point", point: [5, -4, 5] })).toBeNull();
});

test("a turned block answers inside its own footprint only", () => {
  const turned: Scene = { ...SCENE, blocks: [{ ...HOUSE, rotation: 90 }] };

  // Turned clockwise about its corner, the 10 m width runs along +z and the depth along −x.
  expect(picked(turned, { kind: "point", point: [-4, -5, 3] })).toEqual({
    kind: "block",
    index: 0,
  });
  expect(picked(turned, { kind: "point", point: [5, -4, 3] })).toBeNull();
});

test("a tree's crown and a box drill to their obstacle", () => {
  expect(picked(SCENE, { kind: "point", point: [-6, -11, 6] })).toEqual({
    kind: "obstacle",
    index: 0,
  });
  expect(picked(SCENE, { kind: "point", point: [2, -12.5, 2] })).toEqual({
    kind: "obstacle",
    index: 1,
  });
});

test("a module drills to its face's grid editor, a marker to its marker", () => {
  expect(picked(SCENE, { kind: "grid", grid: 0 })).toEqual({ kind: "face", block: 0, face: 1 });
  expect(picked(SCENE, { kind: "equipment", index: 2 })).toEqual({ kind: "marker", index: 2 });
});

test("open ground selects nothing", () => {
  expect(picked(SCENE, { kind: "point", point: [40, -40, 0] })).toBeNull();
});

test("every level backs out to its section, every section to the root", () => {
  expect(parent({ kind: "block", index: 1 })).toEqual({ kind: "section", section: "buildings" });
  expect(parent({ kind: "obstacle", index: 0 })).toEqual({
    kind: "section",
    section: "surroundings",
  });
  expect(parent({ kind: "marker", index: 0 })).toEqual({ kind: "section", section: "equipment" });
  expect(parent({ kind: "place", index: 0 })).toEqual({ kind: "section", section: "equipment" });
  expect(parent({ kind: "face", block: 0, face: 1 })).toEqual({
    kind: "section",
    section: "modules",
  });
  expect(parent({ kind: "string", index: 0 })).toEqual({ kind: "section", section: "strings" });
  expect(parent({ kind: "section", section: "strings" })).toEqual({ kind: "root" });
});

const GARDEN: Scene = {
  ...SCENE,
  obstacles: [
    ...SCENE.obstacles,
    { kind: "hedge", x: 0, z: 20, length: 8, depth: 1, height: 1.8, rotation: 0 },
  ],
  surfaces: [{ x: -2, z: 8, width: 14, depth: 6, rotation: 0, finish: "paving" }],
  fences: [
    {
      points: [
        { x: -10, z: 25 },
        { x: 10, z: 25 },
        { x: 10, z: 30 },
      ],
      height: 1.2,
      finish: "wood",
    },
  ],
};

test("a hedge drills to its obstacle, a fence near its line to its fence", () => {
  expect(picked(GARDEN, { kind: "point", point: [7.5, -20.5, 1.8] })).toEqual({
    kind: "obstacle",
    index: 2,
  });
  expect(picked(GARDEN, { kind: "point", point: [10.1, -28, 1] })).toEqual({
    kind: "fence",
    index: 0,
  });
});

test("a ground surface answers where nothing stands on it", () => {
  expect(picked(GARDEN, { kind: "point", point: [10, -9, 0] })).toEqual({
    kind: "surface",
    index: 0,
  });
  // The box stands on the paving.
  expect(picked(GARDEN, { kind: "point", point: [2, -12.5, 2] })).toEqual({
    kind: "obstacle",
    index: 1,
  });
});

test("surfaces and fences back out to the surroundings", () => {
  for (const kind of ["surface", "fence"] as const) {
    expect(parent({ kind, index: 0 })).toEqual({ kind: "section", section: "surroundings" });
  }
});

/** One place under the 4 m block at x 20, one on the paving turned 90° about its corner. */
const PARKED: Scene = {
  ...GARDEN,
  carPlaces: [
    { device: 3, x: 21, z: 0, width: 2.5, length: 4, rotation: 0 },
    { device: 4, x: 4, z: 9, width: 2.5, length: 5, rotation: 90 },
  ],
};

test("a car place drills to its place, a strike above a car to the roof over it", () => {
  expect(picked(PARKED, { kind: "point", point: [22, -2, 0] })).toEqual({
    kind: "place",
    index: 0,
  });
  expect(picked(PARKED, { kind: "point", point: [22, -2, 1.4] })).toEqual({
    kind: "place",
    index: 0,
  });
  expect(picked(PARKED, { kind: "point", point: [22, -2, 3] })).toEqual({
    kind: "block",
    index: 1,
  });
  // Turned clockwise about its corner, the 5 m length runs along −x.
  expect(picked(PARKED, { kind: "point", point: [1, -10, 0] })).toEqual({
    kind: "place",
    index: 1,
  });
  expect(picked(PARKED, { kind: "point", point: [6, -10, 0] })).toEqual({
    kind: "surface",
    index: 0,
  });
});
