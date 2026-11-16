/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Imported } from "./imported.ts";
import { loadPv, type Scene } from "./pv.ts";

// The release build the gate and the SPA build produce (crates/pv-wasm).
const wasm = new URL(
  "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A 10 m by 8 m gable house at the origin. */
const house: Scene = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 45 } },
  ],
  obstacles: [],
};

/** A document with the building under the house, a neighbour 30 m east, a conifer and a road. */
const DOCUMENT: Imported = {
  radius: 100,
  buildings: [
    {
      id: 0,
      outline: [
        [-0.5, -9],
        [10.5, -9],
        [10.5, 1],
        [-0.5, 1],
      ],
      eave: 6,
      roof: { kind: "flat" },
    },
    {
      id: 1,
      outline: [
        [30, -9],
        [41, -9],
        [41, 1],
        [30, 1],
      ],
      eave: 6,
      roof: { kind: "flat" },
    },
  ],
  trees: [{ at: [-20, 0], height: 8, radius: 2, crown: "conifer" }],
  hedges: [],
  grounds: [
    {
      finish: "road",
      outline: [
        [-50, 20],
        [50, 20],
      ],
      width: 5,
    },
  ],
  terrain: { step: 100, side: 3, heights: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  credits: ["© OpenStreetMap contributors"],
};

const DIGEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

test("a loaded document starts on the scene's origin with the building under the blocks hidden", () => {
  expect(pv.loadImport(DIGEST, house, DOCUMENT)).toEqual({
    document: DIGEST,
    x: 0,
    z: 0,
    turn: 0,
    hidden: [0],
  });
});

test("the crate stands a scene's imported surroundings around its blocks, and none without an import", () => {
  const scene: Scene = {
    ...house,
    imported: { document: DIGEST, x: 0, z: 0, turn: 0, hidden: [0] },
  };

  const around = pv.around(scene, DOCUMENT);

  expect(pv.around(house, DOCUMENT)).toBeNull();
  expect(around?.buildings.map(({ id, hidden }) => [id, hidden])).toEqual([
    [0, true],
    [1, false],
  ]);
  expect(around?.trees.map(({ kind }) => kind)).toEqual(["cylinder", "cone"]);
  expect(around?.grounds).toEqual([
    {
      finish: "road",
      width: 5,
      points: [
        [-50, 20, 0],
        [50, 20, 0],
      ],
    },
  ]);
  expect(around?.terrain.side).toBe(3);
  expect(around?.credits).toEqual(["© OpenStreetMap contributors"]);
});
