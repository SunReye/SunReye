/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  addGrid,
  addString,
  apply,
  painted,
  panels,
  withoutBlock,
  withoutString,
} from "./modules.ts";
import type { Scene } from "./pv.ts";

const block = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

const empty: Scene = { north: 0, blocks: [block, block], obstacles: [], grids: [] };

const gridded = addGrid(empty, 0, 1, 7);

test("a new grid on a face holds portrait modules of its type behind a 0.3 m setback", () => {
  expect(gridded.grids).toEqual([
    { block: 0, face: 1, moduleType: 7, landscape: false, setback: 0.3, modules: [] },
  ]);
});

test("placing toggles a module in a cell, and painting assigns it to a string", () => {
  const placed = apply(gridded, 0, { row: 0, column: 2 }, { kind: "place" });

  expect(placed.grids?.[0]?.modules).toEqual([{ row: 0, column: 2, optimized: false }]);

  const into = apply(placed, 0, { row: 0, column: 2 }, { kind: "paint", string: 1 });

  expect(into.grids?.[0]?.modules).toEqual([{ row: 0, column: 2, string: 1, optimized: false }]);
  expect(apply(placed, 0, { row: 0, column: 2 }, { kind: "place" }).grids?.[0]?.modules).toEqual(
    [],
  );
});

test("painting an empty cell places a module there, and unpainting keeps the module", () => {
  const into = apply(gridded, 0, { row: 1, column: 0 }, { kind: "paint", string: 0 });
  const unpainted = apply(into, 0, { row: 1, column: 0 }, { kind: "paint" });

  expect(into.grids?.[0]?.modules).toEqual([{ row: 1, column: 0, string: 0, optimized: false }]);
  expect(unpainted.grids?.[0]?.modules).toEqual([{ row: 1, column: 0, optimized: false }]);
});

test("the optimizer tool toggles a placed module's optimizer and leaves empty cells empty", () => {
  const placed = apply(gridded, 0, { row: 0, column: 0 }, { kind: "place" });

  expect(
    apply(placed, 0, { row: 0, column: 0 }, { kind: "optimizer" }).grids?.[0]?.modules,
  ).toEqual([{ row: 0, column: 0, optimized: true }]);
  expect(apply(gridded, 0, { row: 0, column: 0 }, { kind: "optimizer" })).toEqual(gridded);
});

test("removing a block drops its grids and renumbers those of later blocks", () => {
  const two = addGrid(addGrid(empty, 0, 0, 7), 1, 1, 7);

  expect(withoutBlock(two, 0).grids?.map((grid) => [grid.block, grid.face])).toEqual([[0, 1]]);
});

test("removing a string unassigns its modules and renumbers later strings", () => {
  let scene = apply(gridded, 0, { row: 0, column: 0 }, { kind: "paint", string: 0 });

  scene = apply(scene, 0, { row: 0, column: 1 }, { kind: "paint", string: 1 });

  expect(withoutString(scene, 0).grids?.[0]?.modules).toEqual([
    { row: 0, column: 0, optimized: false },
    { row: 0, column: 1, string: 0, optimized: false },
  ]);
});

test("a string counts the modules painted into it across faces", () => {
  let scene = addGrid(gridded, 1, 0, 7);

  scene = apply(scene, 0, { row: 0, column: 0 }, { kind: "paint", string: 0 });
  scene = apply(scene, 1, { row: 0, column: 0 }, { kind: "paint", string: 0 });
  scene = apply(scene, 1, { row: 0, column: 1 }, { kind: "place" });

  expect(painted(scene, 0)).toEqual({ modules: 2, optimized: 0 });
});

test("a placed module is drawn where the crate laid out its cell; one outside every cell is not", () => {
  let scene = apply(gridded, 0, { row: 0, column: 0 }, { kind: "paint", string: 0 });

  scene = apply(scene, 0, { row: 5, column: 0 }, { kind: "place" });

  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ] as const;

  const area = [
    [0, 0],
    [1, 1],
  ] as const;

  expect(panels(scene, [[{ row: 0, column: 0, area, corners }]])).toEqual([{ corners, string: 0 }]);
});

test("a new string is wired like the first one, else to device 1, and starts empty", () => {
  const first = addString({ scene: gridded, strings: [] }, "South", 7);

  expect(first.strings).toEqual([
    {
      name: "South",
      moduleType: 7,
      device: 1,
      input: 1,
      modules: 0,
      optimized: 0,
      tilt: 0,
      azimuth: 0,
      loss: 2,
    },
  ]);

  const rewired = {
    scene: gridded,
    strings: [
      {
        name: "South",
        moduleType: 7,
        device: 4,
        input: 2,
        modules: 0,
        optimized: 0,
        tilt: 0,
        azimuth: 0,
        loss: 3,
      },
    ],
  };

  expect(addString(rewired, "North", 7).strings[1]).toMatchObject({ device: 4, loss: 3, input: 1 });
});
