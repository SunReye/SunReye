/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import { cursorOf } from "../../../../../../packages/builder/src/builder/cursor.ts";
import type { Editing } from "../../../../../../packages/builder/src/builder/handles/grabbing.ts";
import type { Scene } from "../../../../../../packages/builder/src/builder/pv.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A 10 × 8 m house with its corner at the origin, and a tree west of it. */
const scene: Scene = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [{ kind: "tree", x: -6, z: 0, radius: 2, height: 8, crown: "broadleaf" }],
  grids: [],
};

function editing(target: Editing["target"], wholeBlock = false): Editing {
  return {
    scene,
    target,
    pv,
    laid: pv.modules(scene, {}),
    turning: false,
    wholeBlock,
    ondrag: () => {},
    ondrop: () => {},
  };
}

// On the house's roof, in the shading frame: east, north, up.
const roof = { kind: "point", point: [5, -4, 5] } as const;
const tree = { kind: "obstacle", index: 0, point: [-6, 0, 4] } as const;
const ground = { kind: "point", point: [30, 30, 0] } as const;
const face = { block: 0, face: 0 };

test("over the picked object a press moves it", () => {
  const picked = editing({ kind: "obstacle", index: 0 });

  expect(cursorOf({ hit: tree, face: null, editing: picked, panning: false })).toBe("move");
});

test("over anything else a press picks it; open ground pans with the default cursor", () => {
  const picked = editing({ kind: "obstacle", index: 0 });

  expect(cursorOf({ hit: roof, face, editing: picked, panning: false })).toBe("pointer");
  expect(cursorOf({ hit: tree, face: null, editing: undefined, panning: false })).toBe("pointer");
  expect(cursorOf({ hit: ground, face: null, editing: picked, panning: false })).toBe("");
  expect(cursorOf({ hit: null, face: null, editing: undefined, panning: false })).toBe("");
});

test("a picked block moves by its roof only where the editor says it does", () => {
  const block = { kind: "block", index: 0 } as const;

  expect(cursorOf({ hit: roof, face, editing: editing(block, true), panning: false })).toBe("move");
  expect(cursorOf({ hit: roof, face, editing: editing(block), panning: false })).toBe("pointer");
});

test("Space held pans whatever is under the pointer", () => {
  const picked = editing({ kind: "obstacle", index: 0 });

  expect(cursorOf({ hit: tree, face: null, editing: picked, panning: true })).toBe("grab");
});
