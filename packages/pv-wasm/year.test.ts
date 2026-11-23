// The engine keeps one shading table between runs of `year` (ADR 17): each run is shaded by the
// scene it is given, whatever ran before.

import { expect, test } from "bun:test";
import { loadPv, type Neighbour, type YearRun } from "./index.js";

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
