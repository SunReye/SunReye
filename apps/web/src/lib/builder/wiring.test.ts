/// <reference types="bun" />
import { expect, test } from "bun:test";
import { addGrid, apply, paint, strokeOf, withoutString } from "./modules.ts";
import type { Scene } from "./pv.ts";
import { wiring } from "./wiring.ts";

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

test("wiring numbers a string's modules in the order a stroke crosses them, after those it holds", () => {
  const stroke = strokeOf(gridded, 0, { row: 0, column: 2 }, { kind: "paint", string: 0 });
  let scene = gridded;

  for (const column of [2, 0, 1, 2]) scene = paint(scene, 0, { row: 0, column }, stroke);

  const next = strokeOf(scene, 0, { row: 1, column: 0 }, { kind: "paint", string: 0 });

  scene = paint(scene, 0, { row: 1, column: 0 }, next);

  expect(scene.grids?.[0]?.modules).toEqual([
    { row: 0, column: 2, string: 0, optimized: false, order: 0 },
    { row: 0, column: 0, string: 0, optimized: false, order: 1 },
    { row: 0, column: 1, string: 0, optimized: false, order: 2 },
    { row: 1, column: 0, string: 0, optimized: false, order: 3 },
  ]);
});

test("an unwired module loses its place in the wiring; a later string's modules keep theirs", () => {
  let scene = apply(gridded, 0, { row: 0, column: 0 }, { kind: "paint", string: 0 });

  scene = apply(scene, 0, { row: 0, column: 1 }, { kind: "paint", string: 1 });

  expect(
    apply(scene, 0, { row: 0, column: 0 }, { kind: "paint", string: 0 }).grids?.[0]?.modules[0],
  ).toEqual({ row: 0, column: 0, optimized: false });
  expect(withoutString(scene, 0).grids?.[0]?.modules).toEqual([
    { row: 0, column: 0, optimized: false },
    { row: 0, column: 1, string: 0, optimized: false, order: 0 },
  ]);
});

/** A 1 m square cell `east` metres along, its centre 1 m up and 0.5 m north. */
function square(east: number) {
  return {
    row: 0,
    column: east,
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

test("a string's wiring runs through its modules' centres in their order, unordered ones last", () => {
  const grid = { block: 0, face: 0, moduleType: 7, landscape: false, setback: 0.3 };

  const wired: Scene = {
    ...gridded,
    grids: [
      {
        ...grid,
        modules: [
          { row: 0, column: 0, string: 0 },
          { row: 0, column: 1, string: 0, order: 4 },
          { row: 0, column: 2, string: 1, order: 0 },
        ],
      },
      { ...grid, face: 1, modules: [{ row: 0, column: 3, string: 0, order: 1 }] },
    ],
  };

  const cells = [[square(0), square(1), square(2)], [square(3)]];

  expect(wiring(wired, cells, 0)).toEqual([
    [3.5, 1, 0.5],
    [1.5, 1, 0.5],
    [0.5, 1, 0.5],
  ]);
});
