/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { StringDraft } from "../api/core.ts";
import { autoStrung } from "./auto-string.ts";
import { addGrid, type Draft } from "./modules.ts";
import { place } from "./placing.ts";
import type { Scene } from "./pv.ts";
import { wiredInto } from "./selecting.ts";

const block = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

const bare: Scene = { north: 0, blocks: [block], obstacles: [], grids: [] };

/** Two rows of eight portrait modules from the setback's corner: 0–7 below, 8–15 above. */
const spots = Array.from({ length: 16 }, (_, i) => ({
  across: 0.3 + (i % 8) * 1.154,
  up: 0.3 + Math.floor(i / 8) * 1.742,
  landscape: false,
}));

const scene = place(addGrid(bare, 0, 1, 7), 0, spots);

const first: StringDraft = {
  name: "Garage",
  moduleType: 7,
  device: 1,
  input: 1,
  modules: 0,
  optimized: 0,
  tilt: 0,
  azimuth: 0,
  loss: 3,
};

const draft: Draft = { scene, strings: [first] };
const name = (number: number) => `String ${String(number)}`;

/** The modules of string `string` in their wiring order, by their position in the grid. */
function run(of: Draft | null, string: number): number[] {
  const modules = of?.scene.grids?.[0]?.modules ?? [];

  return modules
    .flatMap((module, at) => (module.string === string ? [[module.order ?? -1, at] as const] : []))
    .toSorted((a, b) => a[0] - b[0])
    .map(([, at]) => at);
}

test("a face's unwired modules run in a serpentine into as few even strings as the limit allows", () => {
  const strung = autoStrung(draft, 0, { longest: 6, device: 1, inputs: 3 }, name);

  // 16 modules at most 6 long: three strings of 6, 5 and 5.
  expect(run(strung, 1)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(run(strung, 2)).toEqual([6, 7, 15, 14, 13]);
  expect(run(strung, 3)).toEqual([12, 11, 10, 9, 8]);
  // Input 1 carries the garage: the free inputs in order, then in parallel on the last.
  expect(strung?.strings.slice(1)).toEqual([
    { ...first, name: "String 2", input: 2 },
    { ...first, name: "String 3", input: 3 },
    { ...first, name: "String 4", input: 3 },
  ]);
});

test("without a limit the face is one string; wired modules stay as they are; none unwired, nothing", () => {
  const partly = wiredInto(draft, [{ grid: 0, module: 3 }], 0) ?? draft;
  const strung = autoStrung(partly, 0, { longest: null, device: 1, inputs: 0 }, name);

  expect(run(strung, 0)).toEqual([3]);
  expect(run(strung, 1)).toEqual([0, 1, 2, 4, 5, 6, 7, 15, 14, 13, 12, 11, 10, 9, 8]);
  expect(strung?.strings[1]).toEqual({ ...first, name: "String 2", input: 1 });

  expect(strung && autoStrung(strung, 0, { longest: 6, device: 1, inputs: 3 }, name)).toBeNull();
});
