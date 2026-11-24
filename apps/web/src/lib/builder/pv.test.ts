/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import type { GridModule, Scene } from "@sunreye/scene";
import { sunAt, sunward } from "../../../../../packages/builder/src/builder/pv.ts";

// The engine as @sunreye/pv-wasm ships it.
const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

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

test("a tree reaches the browser as a trunk under a sphere crown, both naming it", () => {
  expect(pv.geometry(house).solids).toEqual([
    { kind: "cylinder", base: [-4, 0, 0], radius: 0.2, height: 8, obstacle: 0 },
    { kind: "sphere", centre: [-4, 0, 8], radius: 2, obstacle: 0 },
  ]);
});

test("a conifer reaches the browser as a trunk under a cone, a hedge as faces drawn as hedge", () => {
  const garden: Scene = {
    north: 0,
    blocks: [],
    obstacles: [
      { kind: "tree", x: -4, z: 0, radius: 2, height: 10, crown: "conifer" },
      { kind: "hedge", x: 0, z: 5, length: 6, depth: 0.8, height: 1.8, rotation: 0 },
    ],
  };

  const { faces, solids } = pv.geometry(garden);

  expect(solids).toEqual([
    { kind: "cylinder", base: [-4, 0, 0], radius: 0.2, height: 2, obstacle: 0 },
    { kind: "cone", base: [-4, 0, 2], radius: 2, height: 8, obstacle: 0 },
  ]);
  expect(faces.map(({ surface, obstacle }) => [surface, obstacle])).toEqual(
    Array.from({ length: 5 }, () => ["hedge", 1]),
  );
});

test("ground surfaces lie on the ground and fences run through their points; refused, none", () => {
  const surrounded: Scene = {
    ...house,
    surfaces: [{ x: 0, z: 10, width: 4, depth: 2, rotation: 0, finish: "driveway" }],
    fences: [
      {
        points: [
          { x: 0, z: 12 },
          { x: 6, z: 12 },
        ],
        height: 1.2,
        finish: "metal",
      },
    ],
  };

  const { ground, fences } = pv.geometry(surrounded);

  expect(ground).toEqual([
    {
      finish: "driveway",
      corners: [
        [0, -10, 0],
        [4, -10, 0],
        [4, -12, 0],
        [0, -12, 0],
      ],
    },
  ]);
  expect(fences).toEqual([
    {
      finish: "metal",
      height: 1.2,
      points: [
        [0, -12, 0],
        [6, -12, 0],
      ],
    },
  ]);

  const refused = pv.geometry({
    ...surrounded,
    surfaces: [{ x: 0, z: 0, width: 0, depth: 2, rotation: 0, finish: "gravel" }],
    fences: [{ points: [{ x: 0, z: 0 }], height: 1, finish: "wall" }],
  });

  expect([refused.ground, refused.fences]).toEqual([null, null]);
});

test("an equipment marker hangs on its wall with its label above the ridge", () => {
  const marked: Scene = {
    ...house,
    equipment: [{ device: 1, kind: "inverter", block: 0, wall: "front", along: 2, inside: false }],
  };

  expect(pv.geometry(marked).mounts).toEqual([
    { at: [2, -8.1, 1.5], above: [2, -8.1, 8], out: [0, -1, 0] },
  ]);
  expect(pv.geometry(house).mounts).toEqual([]);
});

test("on a house turned by the compass a marker hangs on the turned wall, facing out of it", () => {
  const turned: Scene = {
    ...house,
    north: 90,
    equipment: [{ device: 1, kind: "inverter", block: 0, wall: "front", along: 2, inside: false }],
  };

  const [mount] = pv.geometry(turned).mounts ?? [];
  const front = pv.modules(turned, {}).walls[0]?.front;

  if (mount === undefined || front === undefined) throw new Error("no marker on a wall");

  // From the wall's left end: 2 m along it and 10 cm out of it, as on the unturned house.
  const [east, north] = [mount.at[0] - front.left[0], mount.at[1] - front.left[1]];
  const along = (way: readonly [number, number, number]) => east * way[0] + north * way[1];

  expect(along(front.right)).toBeCloseTo(2, 9);
  expect(along(front.out)).toBeCloseTo(0.1, 9);
  expect(mount.out[0] * front.out[0] + mount.out[1] * front.out[1]).toBeCloseTo(1, 9);
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

function gridded(modules: readonly GridModule[]): Scene {
  const block = house.blocks[0];

  return {
    ...house,
    blocks: block === undefined ? [] : [{ ...block, roof: { kind: "gable", pitch: 35 } }],
    grids: [{ block: 0, face: 1, moduleType: 7, landscape: false, setback: 0.3, modules }],
  };
}

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
  const painted = [0, 1, 2, 3].map((column) => ({
    across: 0.3 + column * 1.154,
    up: 0.3,
    landscape: false,
    string: 0,
    optimized: false,
  }));

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

test("each string's open-circuit voltage at −10 °C scales its modules' Voc by the coefficient", () => {
  // 16 × 41 V × (1 + 0.27 %/K × 35 K), worked by hand.
  const [volts] = pv.coldVoltages([datasheet], [wired(16, 0)]);

  expect(volts).toBeCloseTo(717.992, 3);
  // An unknown module type has no voltage.
  expect(pv.coldVoltages([], [wired(16, 0)])).toEqual([null]);
});

test("the sun due south at 60° from the zenith shines from the south, up", () => {
  const [east, north, up] = sunward({ zenith: 60, azimuth: 0 });

  expect(east).toBeCloseTo(0, 9);
  expect(north).toBeCloseTo(-Math.sqrt(3) / 2, 9);
  expect(up).toBeCloseTo(0.5, 9);
});

test("the sun stands where the plant's location and the time put it", () => {
  const berlin = { latitude: 52.52, longitude: 13.4 };
  // Solar noon in Berlin on the June solstice: about 11:07 UTC, 61° high.
  const [east, north, up] = sunAt(pv, berlin, Date.parse("2026-06-21T11:07:00Z"));

  expect(Math.abs(east)).toBeLessThan(0.02);
  expect(north).toBeLessThan(0);
  expect((Math.asin(up) * 180) / Math.PI).toBeCloseTo(61, 0);

  // Midnight: below the horizon, in the north.
  const [, midnightNorth, midnightUp] = sunAt(pv, berlin, Date.parse("2026-06-21T23:07:00Z"));

  expect(midnightUp).toBeLessThan(0);
  expect(midnightNorth).toBeGreaterThan(0);
});
