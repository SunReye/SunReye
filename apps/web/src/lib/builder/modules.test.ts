/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  addGrid,
  clearGrid,
  addString,
  optimize,
  panels,
  refuses,
  wire,
  wiredIn,
  withoutBlock,
  withoutString,
} from "./modules.ts";
import { place } from "./placing.ts";
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

/** Portrait modules side by side from the setback's corner, 2 cm apart, by their position. */
const spot = (i: number) => ({ across: 0.3 + i * 1.154, up: 0.3, landscape: false });
const spots = (count: number) => Array.from({ length: count }, (_, i) => spot(i));

/** The south face's grid with `count` modules. */
const laid = (count: number) => place(gridded, 0, spots(count));

const [first, second] = [spot(0), spot(1)];

test("a module's optimizer is set and taken, the rest of it kept", () => {
  const wired = wire(laid(1), 0, 0, 0);
  const on = optimize(wired, 0, 0, true);

  expect(on.grids?.[0]?.modules).toEqual([{ ...first, string: 0, order: 0, optimized: true }]);
  expect(optimize(on, 0, 0, false).grids?.[0]?.modules).toEqual([
    { ...first, string: 0, order: 0, optimized: false },
  ]);
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
  let scene = wire(laid(2), 0, 0, 0);

  scene = wire(scene, 0, 1, 1);

  expect(withoutString(scene, 0).grids?.[0]?.modules).toEqual([
    { ...first, optimized: false },
    { ...second, string: 0, optimized: false, order: 0 },
  ]);
});

test("a string counts the modules wired into it across faces", () => {
  let scene = place(addGrid(laid(1), 1, 0, 7), 1, spots(2));

  scene = wire(scene, 0, 0, 0);
  scene = wire(scene, 1, 0, 0);

  expect(wiredIn(scene, 0)).toEqual({ modules: 2, optimized: 0 });
});

test("a module is drawn where the crate laid it out, named by its place in its grid", () => {
  const scene = wire(laid(2), 0, 1, 0);
  const grids = pv.modules(scene, SIZES).grids;
  const drawn = panels(scene, grids);

  expect(drawn.map(({ string, grid, module }) => [string, grid, module])).toEqual([
    [null, 0, 0],
    [0, 0, 1],
  ]);
  expect(drawn[1]?.corners).toEqual(grids[0]?.modules[1]?.corners);
  // The second module's lower left corner: 1.454 m east of the south eave's west end, 0.3 m up it.
  expect(drawn[1]?.corners[0]?.[0]).toBeCloseTo(1.454, 6);
  // A grid the crate could not lay out draws nothing.
  expect(panels(scene, [null])).toEqual([]);
});

test("a new string is wired like the first one, else to device 1, and starts empty", () => {
  const added = addString({ scene: gridded, strings: [] }, "South", 7);

  expect(added.strings).toEqual([
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

test("wiring into a grid of another module type than the string is refused", () => {
  const draft = {
    scene: addGrid(gridded, 1, 0, 8),
    strings: addString({ scene: gridded, strings: [] }, "South", 7).strings,
  };

  expect(refuses(draft, 0, 0)).toBe(false);
  expect(refuses(draft, 1, 0)).toBe(true);
});

test("clearing a face takes its modules and keeps its grid", () => {
  expect(clearGrid(laid(3), 0).grids).toEqual(gridded.grids);
});
