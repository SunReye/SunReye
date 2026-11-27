/// <reference types="bun" />
// Neighbours the builder's consumer supplies (ADR 20), through the pv crate's release build.
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import { type Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import type { Neighbour } from "../../../../../../packages/builder/src/builder/pv.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A 10 m × 8 m gable house at 35° with four modules low on its south face. */
const house: Scene = {
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
};

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

const string = {
  name: "",
  moduleType: 7,
  device: 1,
  input: 1,
  modules: 4,
  optimized: 0,
  tilt: 35,
  azimuth: 0,
  loss: 2,
};

/** The string's clear-sky watts on 2026-06-21 at 11:00 UTC over Berlin. */
function noon(neighbours?: readonly Neighbour[]): number {
  const run = {
    location: { latitude: 52.52, longitude: 13.38 },
    scene: house,
    moduleTypes: [datasheet],
    strings: [string],
    times: [1_782_039_600],
  };

  const [[watts = 0] = []] = pv.clearSky(neighbours === undefined ? run : { ...run, neighbours });

  return watts;
}

test("a supplied neighbour south of the house shades its string under a clear sky", () => {
  // A 30 m wall 2 m south of the front eave, east and north of the scene's origin.
  const wall: Neighbour = {
    footprint: [
      [-5, -10],
      [15, -10],
      [15, -10.3],
      [-5, -10.3],
    ],
    height: 30,
  };

  const open = noon();

  expect(noon([])).toBe(open);
  expect(noon([wall])).toBeLessThan(open / 2);
});

test("a supplied neighbour reaches the browser as its walls and its top, east and north up", () => {
  const faces = pv.neighbours([
    {
      footprint: [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
      height: 6,
    },
  ]);

  expect(faces).toHaveLength(4);
  expect(faces[3]).toEqual({
    surface: "obstacle",
    corners: [
      [0, 0, 6],
      [4, 0, 6],
      [4, 3, 6],
    ],
  });
  expect(() => pv.neighbours([{ footprint: [[0, 0]], height: 6 }])).toThrow("three corners");
});
