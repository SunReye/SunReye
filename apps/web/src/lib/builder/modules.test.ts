/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  addGrid,
  addString,
  apply,
  fillGrid,
  paint,
  painted,
  panels,
  refuses,
  strokeOf,
  stroked,
  withoutBlock,
  withoutString,
} from "./modules.ts";
import { loadPv, type Scene } from "./pv.ts";

const wasm = new URL(
  "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

const pv = await loadPv(await Bun.file(wasm).bytes());

const SIZES = { 7: { width: 1.134, height: 1.722 } };

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

test("removing a block drops the chimneys on its roof and renumbers those of later blocks", () => {
  const stack = { face: 0, across: 2, up: 2, width: 0.6, depth: 0.6, height: 1 } as const;

  const stacked: Scene = {
    ...empty,
    chimneys: [
      { ...stack, block: 0 },
      { ...stack, block: 1 },
    ],
  };

  expect(withoutBlock(stacked, 0).chimneys).toEqual([{ ...stack, block: 0 }]);
});

test("removing a block drops the equipment on its walls and renumbers that of later blocks", () => {
  const marker = { device: 1, kind: "inverter", wall: "front", along: 1, inside: false } as const;

  const marked: Scene = {
    ...empty,
    equipment: [
      { ...marker, block: 0 },
      { ...marker, block: 1, kind: "battery" },
    ],
  };

  expect(withoutBlock(marked, 0).equipment).toEqual([{ ...marker, block: 0, kind: "battery" }]);
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

  expect(panels(scene, [[{ row: 0, column: 0, area, corners }]])).toEqual([
    { corners, string: 0, grid: 0, row: 0, column: 0 },
  ]);
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

test("fill face places a module in every cell the crate's grid holds, keeping painted ones", () => {
  const started = apply(gridded, 0, { row: 0, column: 1 }, { kind: "paint", string: 0 });
  const cells = pv.modules(started, SIZES).grids[0] ?? [];
  const filled = fillGrid(started, 0, cells);

  // A 10 m wide, 4.883 m deep face behind a 0.3 m setback holds 8 × 2 portrait modules.
  expect(cells).toHaveLength(16);
  expect(filled.grids?.[0]?.modules).toHaveLength(16);
  expect(filled.grids?.[0]?.modules).toContainEqual({
    row: 0,
    column: 1,
    string: 0,
    optimized: false,
  });
  expect(pv.modules(filled, SIZES).misplaced).toBeNull();
});

test("a drag that starts on an empty cell places along its path, one that starts on a module erases", () => {
  const placing = strokeOf(gridded, 0, { row: 0, column: 0 }, { kind: "place" });
  let scene = paint(gridded, 0, { row: 0, column: 0 }, placing);

  scene = paint(scene, 0, { row: 0, column: 1 }, placing);
  scene = paint(scene, 0, { row: 0, column: 1 }, placing);

  expect(scene.grids?.[0]?.modules).toHaveLength(2);

  const erasing = strokeOf(scene, 0, { row: 0, column: 1 }, { kind: "place" });

  scene = paint(scene, 0, { row: 0, column: 1 }, erasing);
  scene = paint(scene, 0, { row: 0, column: 0 }, erasing);
  scene = paint(scene, 0, { row: 1, column: 0 }, erasing);

  expect(scene.grids?.[0]?.modules).toEqual([]);
});

test("a string stroke paints across grids, and one starting on the string's own module unpaints", () => {
  const two = addGrid(gridded, 1, 0, 7);
  const painting = strokeOf(two, 0, { row: 0, column: 0 }, { kind: "paint", string: 0 });
  let scene = paint(two, 0, { row: 0, column: 0 }, painting);

  scene = paint(scene, 1, { row: 0, column: 0 }, painting);

  expect(painted(scene, 0).modules).toBe(2);

  const unpainting = strokeOf(scene, 1, { row: 0, column: 0 }, { kind: "paint", string: 0 });

  scene = paint(scene, 1, { row: 0, column: 0 }, unpainting);
  scene = paint(scene, 0, { row: 0, column: 0 }, unpainting);

  expect(painted(scene, 0).modules).toBe(0);
  expect(scene.grids?.flatMap((grid) => grid.modules)).toHaveLength(2);
});

test("painting a string into a grid of another module type is refused", () => {
  const draft = {
    scene: addGrid(gridded, 1, 0, 8),
    strings: addString({ scene: gridded, strings: [] }, "South", 7).strings,
  };

  expect(refuses(draft, 0, { kind: "paint", string: 0 })).toBe(false);
  expect(refuses(draft, 1, { kind: "paint", string: 0 })).toBe(true);
  expect(refuses(draft, 1, { kind: "paint" })).toBe(false);
  expect(refuses(draft, 1, { kind: "place", erase: false })).toBe(false);
});

test("a stroke leaves each cell with a module or none, keeping what it does not change", () => {
  const at = { row: 0, column: 0 };
  const module = { row: 0, column: 0, string: 1, optimized: true };

  expect(stroked(undefined, at, { kind: "place", erase: false })).toEqual({
    ...at,
    optimized: false,
  });
  expect(stroked(module, at, { kind: "place", erase: false })).toBe(module);
  expect(stroked(module, at, { kind: "place", erase: true })).toBeUndefined();
  expect(stroked(undefined, at, { kind: "optimizer", on: true })).toBeUndefined();
  expect(stroked(module, at, { kind: "optimizer", on: false })).toEqual({
    ...module,
    optimized: false,
  });
  expect(stroked(undefined, at, { kind: "paint", string: 2, erase: true })).toBeUndefined();
  expect(stroked(undefined, at, { kind: "paint", string: 2, erase: false })).toEqual({
    ...at,
    string: 2,
    optimized: false,
  });
  expect(stroked(module, at, { kind: "paint", string: 1, erase: true })).toEqual({
    ...at,
    optimized: true,
  });
});
