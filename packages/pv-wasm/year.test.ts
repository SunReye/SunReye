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

/** A 30 m wall 2 m north of the back eave: behind the south face, out of the noon sun's way. */
const behind: Neighbour = {
  footprint: [
    [-5, 6],
    [15, 6],
    [15, 6.3],
    [-5, 6.3],
  ],
  height: 30,
};

test("a clear-sky run loses the sky a neighbour hides, though it shades no beam", () => {
  const { weather: _, ...rest } = plant;
  const times = [Date.UTC(2026, 5, 21, 11) / 1000];
  const [[open = 0] = []] = pv.clearSky({ ...rest, times });
  const [[walled = 0] = []] = pv.clearSky({ ...rest, times, neighbours: [behind] });

  expect(walled).toBeLessThan(open);
  expect(walled).toBeGreaterThan(0.9 * open);
});

test("a horizon of any other shape is refused", () => {
  expect(() => pv.year({ ...plant, horizon: hill.slice(1) })).toThrow("360");
});

const limits = { maxCurrent: 30, minVoltage: 80, maxVoltage: 1000, startVoltage: 100 };

/** The plant on a small typed inverter, soiled, cabled and warranted. */
const supplied: YearRun = {
  ...plant,
  inverterTypes: {
    1: {
      maker: "Example",
      model: "Small",
      maxInputVoltage: 1100,
      acRating: 1200,
      efficiency: 97,
      inputs: [limits],
    },
  },
  soiling: 2,
  cables: {
    dc: [{ length: 20, crossSection: 4 }],
    ac: { 1: { length: 15, crossSection: 2.5, threePhase: false } },
  },
  warranty: { firstYear: 2, yearly: 0.55, years: 25 },
};

test("a run returns its loss chain from the planes to the grid, with what the caller supplies", () => {
  const ran = pv.year(supplied);

  const [inverter] = ran.inverters;

  if (inverter === undefined) throw new Error("the run has its inverter");

  const steps = inverter.chain.steps;

  expect(steps.map((step) => step.id)).toEqual([
    "beam_shading",
    "diffuse_shading",
    "incidence",
    "soiling",
    "irradiance_level",
    "temperature",
    "string",
    "mismatch",
    "mppt_limits",
    "dc_cable",
    "inverter",
    "clipping",
    "ac_cable",
  ]);
  expect(steps[3]).toMatchObject({ en: "Soiling", de: "Verschmutzung" });

  const planes = inverter.chain.planes.total;
  const lost = steps.reduce((sum, step) => sum + step.lost.total, 0);
  const grid = steps.at(-1)?.after.total ?? 0;

  expect(lost).toBeCloseTo(planes - grid, 6);
  expect(steps.at(-2)?.after.total).toBe(inverter.ac?.energy.total);
  expect(grid).toBeLessThan(inverter.ac?.energy.total ?? 0);
  expect(ran.chain).toEqual(inverter.chain);
  expect(ran.years).toHaveLength(25);
  expect(ran.years?.[0]).toBeCloseTo(0.99 * grid, 6);
});

test("a loss a run does not compute is absent from its chain", () => {
  const [inverter] = pv.year(plant).inverters;

  expect(inverter?.chain.steps.map((step) => step.id)).toEqual([
    "beam_shading",
    "diffuse_shading",
    "incidence",
    "irradiance_level",
    "temperature",
    "string",
    "mismatch",
  ]);
  expect(pv.year(plant).years).toBeUndefined();
});
