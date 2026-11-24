// The engine keeps one shading table between runs of `year` (ADR 17): each run is shaded by the
// scene and the horizon it is given, whatever ran before.

import { expect, test } from "bun:test";
import { type HorizonProfile, loadPv, type Neighbour, type YearRun } from "./index.js";

const pv = await loadPv(await Bun.file(new URL("dist/pv.wasm", import.meta.url)).bytes());

/** A 10 m × 8 m gable house at 35° with four modules low on its south face, over two bright
 * quarter hours of 2026-06-21. */
const plant: YearRun = {
  location: { latitude: 52.52, longitude: 13.38 },
  scene: {
    north: 0,
    blocks: [
      { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
    ],
    obstacles: [],
    grids: [
      {
        block: 0,
        face: 1,
        moduleType: 7,
        landscape: false,
        setback: 0.3,
        modules: [0, 1, 2, 3].map((column) => ({
          across: 0.3 + column * 1.154,
          up: 0.3,
          landscape: false,
          string: 0,
          optimized: false,
        })),
      },
    ],
  },
  moduleTypes: [
    {
      id: 7,
      vmp: 34,
      imp: 11.76,
      voc: 41,
      isc: 12.5,
      voltageCoefficient: -0.27,
      currentCoefficient: 0.05,
      width: 1.134,
      height: 1.722,
      bypassDiodes: 3,
    },
  ],
  strings: [
    {
      name: "",
      moduleType: 7,
      device: 1,
      input: 1,
      modules: 4,
      optimized: 0,
      tilt: 35,
      azimuth: 0,
      loss: 2,
    },
  ],
  weather: {
    start: Date.UTC(2026, 5, 21, 10, 45) / 1000,
    step: 900,
    ghi: [850, 880],
    dni: [780, 800],
    dhi: [150, 150],
    temperature: [24, 25],
  },
};

/** A 30 m wall 2 m south of the front eave. */
const wall: Neighbour = {
  footprint: [
    [-5, -10],
    [15, -10],
    [15, -10.3],
    [-5, -10.3],
  ],
  height: 30,
};

function total(run: YearRun): number {
  const [string] = pv.year(run).strings;

  return string?.total ?? Number.NaN;
}

test("a run is shaded by the scene it is given, whatever ran before", () => {
  const open = total(plant);
  const walled = total({ ...plant, neighbours: [wall] });

  expect(walled).toBeLessThan(open / 2);
  expect(total(plant)).toBe(open);
});

/** One elevation per degree from −180 going east, by azimuth (0 = south, −90 = east). */
function horizon(at: (azimuth: number) => number): HorizonProfile {
  return Array.from({ length: 360 }, (_, k) => [k - 180, at(k - 180)] as const);
}

/** 70° high across the south, where the late-morning sun stands. */
const hill = horizon((azimuth) => (Math.abs(azimuth) <= 30 ? 70 : 0));

test("a sun below the horizon gives no beam, and a run without one computes as before", () => {
  const open = total(plant);
  const hidden = total({ ...plant, horizon: hill });

  expect(hidden).toBeGreaterThan(0);
  expect(hidden).toBeLessThan(open / 2);
  expect(total(plant)).toBe(open);
});

test("a clear-sky run takes the horizon too", () => {
  const { weather: _, ...rest } = plant;
  const times = [Date.UTC(2026, 5, 21, 10, 45) / 1000];
  const [[open = 0] = []] = pv.clearSky({ ...rest, times });
  const [[hidden = 0] = []] = pv.clearSky({ ...rest, times, horizon: hill });

  expect(hidden).toBeGreaterThan(0);
  expect(hidden).toBeLessThan(open / 2);
});

test("a horizon of any other shape is refused", () => {
  expect(() => pv.year({ ...plant, horizon: hill.slice(1) })).toThrow("360");
});
