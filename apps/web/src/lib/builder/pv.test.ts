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

test("a carport has posts for walls and a car stands at its place's centre, nose forward", () => {
  const carport: Scene = {
    north: 0,
    blocks: [
      {
        x: 0,
        z: 0,
        width: 3,
        depth: 5,
        eave: 2.2,
        rotation: 0,
        roof: { kind: "flat" },
        open: true,
      },
    ],
    obstacles: [],
    carPlaces: [{ device: 2, x: 0.25, z: 0, width: 2.5, length: 5, rotation: 0 }],
  };

  const { faces, solids, stands } = pv.geometry(carport);

  expect(faces.map(({ surface }) => surface)).toEqual(["roof"]);
  expect(solids).toHaveLength(4);
  expect(stands).toEqual([{ at: [1.5, -2.5, 0], forward: [0, 1, 0], above: [1.5, -2.5, 2.5] }]);
});

const BERLIN = { latitude: 52.52, longitude: 13.38 };

test("the sun over Berlin stands as NREL SPA has it", () => {
  // 2026-06-21T11:30Z (crates/pv/fixtures/sun.csv).
  const sun = pv.sun(1_782_041_400, BERLIN);

  expect(sun.zenith).toBeCloseTo(29.377, 1);
  expect(sun.azimuth).toBeCloseTo(10.189, 1);
});

const datasheet = {
  id: 7,
  name: "Owner 400",
  pmax: 400,
  vmp: 34,
  imp: 11.76,
  voc: 41,
  isc: 12.5,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.722,
  bypassDiodes: 3,
};

function wired(modules: number, azimuth: number) {
  return {
    name: "",
    moduleType: 7,
    device: 1,
    input: 1,
    modules,
    optimized: 0,
    tilt: 35,
    azimuth,
    loss: 2,
  };
}

test("a clear sky lights a painted south string over one entered by form facing north", () => {
  const painted = [0, 1, 2, 3].map((column) => ({ row: 0, column, string: 0, optimized: false }));

  const run = (unix: number) =>
    pv.clearSky({
      location: BERLIN,
      scene: gridded(painted),
      moduleTypes: [datasheet],
      // The painted string's count and plane come from its modules.
      strings: [wired(4, 90), { ...wired(4, 180), input: 2 }],
      times: [unix],
    });

  // 2026-06-21, midnight and 11:00 UTC.
  const [[southDark, northDark] = []] = run(1_782_000_000);
  const [[south = 0, north = 0] = []] = run(1_782_039_600);

  expect([southDark, northDark]).toEqual([0, 0]);
  expect(south).toBeGreaterThan(north);
  expect(south).toBeLessThan(4 * 400);
  expect(north).toBeGreaterThan(0);
});
