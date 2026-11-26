/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  addGrid,
  wire,
  withoutString,
} from "../../../../../../packages/builder/src/builder/modules.ts";
import { place } from "../../../../../../packages/builder/src/builder/placing.ts";
import type { Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import { wiring } from "../../../../../../packages/builder/src/builder/wiring.ts";

const block = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

const gridded = addGrid(
  { north: 0, blocks: [block, block], obstacles: [], grids: [] } satisfies Scene,
  0,
  1,
  7,
);

/** Portrait modules side by side from the setback's corner, 2 cm apart, by their position. */
const spot = (i: number) => ({ across: 0.3 + i * 1.154, up: 0.3, landscape: false });
const spots = (count: number) => Array.from({ length: count }, (_, i) => spot(i));

const laid = place(gridded, 0, spots(4));
const [first, second, third, fourth] = [spot(0), spot(1), spot(2), spot(3)];

test("wiring numbers a string's modules in the order they are wired, after those it holds", () => {
  let scene = laid;

  // The third again: wired into its own string, it keeps its place.
  for (const module of [2, 0, 1, 2, 3]) scene = wire(scene, 0, module, 0);

  expect(scene.grids?.[0]?.modules).toEqual([
    { ...first, string: 0, optimized: false, order: 1 },
    { ...second, string: 0, optimized: false, order: 2 },
    { ...third, string: 0, optimized: false, order: 0 },
    { ...fourth, string: 0, optimized: false, order: 3 },
  ]);
});

test("an unwired module loses its place in the wiring; a later string's modules keep theirs", () => {
  let scene = wire(laid, 0, 0, 0);

  scene = wire(scene, 0, 1, 1);

  expect(wire(scene, 0, 0).grids?.[0]?.modules[0]).toEqual({
    ...first,
    optimized: false,
  });
  expect(withoutString(scene, 0).grids?.[0]?.modules.slice(0, 2)).toEqual([
    { ...first, optimized: false },
    { ...second, string: 0, optimized: false, order: 0 },
  ]);
});

/** A module laid out `east` metres along, its centre 1 m up and 0.5 m north. */
function square(east: number) {
  return {
    area: [
      [0, 0],
      [1, 1],
    ],
    corners: [
      [east, 0, 0],
      [east + 1, 0, 0],
      [east + 1, 2, 0],
      [east, 2, 2],
    ],
  } as const;
}

/** A grid as the crate lays it out, its modules `squares`. */
const onFace = (...modules: readonly ReturnType<typeof square>[]) => ({
  modules,
  outline: [],
  inset: null,
  blocked: [],
});

test("a string's wiring runs through its modules' centres in their order, unordered ones last", () => {
  const grid = { block: 0, face: 0, moduleType: 7, landscape: false, setback: 0.3 };
  const at = { across: 0, up: 0, landscape: false };

  const wired: Scene = {
    ...gridded,
    grids: [
      {
        ...grid,
        modules: [
          { ...at, string: 0 },
          { ...at, string: 0, order: 4 },
          { ...at, string: 1, order: 0 },
        ],
      },
      { ...grid, face: 1, modules: [{ ...at, string: 0, order: 1 }] },
    ],
  };

  const grids = [onFace(square(0), square(1), square(2)), onFace(square(3))];

  expect(wiring(wired, grids, 0)).toEqual([
    [3.5, 1, 0.5],
    [1.5, 1, 0.5],
    [0.5, 1, 0.5],
  ]);
});
