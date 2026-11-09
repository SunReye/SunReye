/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv, type Scene } from "./pv.ts";

// The release build the gate and the SPA build produce (crates/pv-wasm).
const wasm = new URL(
  "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

const pv = await loadPv(await Bun.file(wasm).bytes());

const house: Scene = {
  north: 0,
  blocks: [
    {
      x: 0,
      z: 0,
      width: 10,
      depth: 8,
      eave: 3,
      rotation: 0,
      roof: { kind: "gable", pitch: 45 },
    },
  ],
  obstacles: [{ kind: "tree", x: -4, z: 0, radius: 2, height: 10 }],
};

test("the pv crate draws a gable house's ridge 4 m above its eave, east and north up", () => {
  const { faces } = pv.geometry(house);
  const roofs = faces.filter((face) => face.surface === "roof");

  expect(roofs).toHaveLength(2);
  expect(roofs[0]?.corners).toContainEqual([10, -4, 7]);
  expect(faces.filter((face) => face.surface === "wall")).toHaveLength(4);
});

test("a tree reaches the browser as a trunk under a sphere crown", () => {
  expect(pv.geometry(house).solids).toEqual([
    { kind: "cylinder", base: [-4, 0, 0], radius: 0.2, height: 8 },
    { kind: "sphere", centre: [-4, 0, 8], radius: 2 },
  ]);
});

test("a scene the crate cannot read throws", () => {
  // JSON has no NaN: it crosses as null.
  const broken = { ...house, north: Number.NaN };

  expect(() => pv.geometry(broken)).toThrow();
});
