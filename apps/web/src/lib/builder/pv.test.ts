/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv, type Cell, type Scene } from "./pv.ts";

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
  grids: [],
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

test("an equipment marker hangs on its wall with its label above the ridge", () => {
  const marked: Scene = {
    ...house,
    equipment: [{ device: 1, kind: "inverter", block: 0, wall: "front", along: 2, inside: false }],
  };

  expect(pv.geometry(marked).mounts).toEqual([{ at: [2, -8.1, 1.5], above: [2, -8.1, 8] }]);
  expect(pv.geometry(house).mounts).toEqual([]);
});

test("a marker off its wall has no mounts drawn", () => {
  const off: Scene = {
    ...house,
    equipment: [{ device: 1, kind: "battery", block: 0, wall: "left", along: 9, inside: true }],
  };

  expect(pv.geometry(off).mounts).toBeNull();
});

test("a scene the crate cannot read throws", () => {
  // JSON has no NaN: it crosses as null.
  const broken = { ...house, north: Number.NaN };

  expect(() => pv.geometry(broken)).toThrow();
});

const sizes = { 7: { width: 1.134, height: 1.722 } };

function gridded(modules: readonly Cell[]): Scene {
  const block = house.blocks[0];

  return {
    ...house,
    blocks: block === undefined ? [] : [{ ...block, roof: { kind: "gable", pitch: 35 } }],
    grids: [{ block: 0, face: 1, moduleType: 7, landscape: false, setback: 0.3, modules }],
  };
}

test("the crate lays out a south face's cells: 8 columns and 2 rows of portrait modules", () => {
  const { roofs, grids, misplaced } = pv.modules(gridded([]), sizes);

  expect(roofs.map(({ tilt, azimuth }) => [Math.round(tilt), Math.round(azimuth)])).toEqual([
    [35, 180],
    [35, 0],
  ]);
  expect(grids[0]?.length).toBe(16);
  expect(misplaced).toBeNull();
});

test("a module beyond the setback comes back misplaced", () => {
  const { misplaced } = pv.modules(gridded([{ row: 2, column: 0, optimized: false }]), sizes);

  expect(misplaced).toEqual({ kind: "setback", grid: 0, row: 2, column: 0 });
});
