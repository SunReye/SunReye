/// <reference types="bun" />
import { expect, test } from "bun:test";
import { addGrid, editGrid, fillGrid, uncovered, wire } from "./modules.ts";
import { move, place, removeModule } from "./placing.ts";
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

/** Portrait modules side by side from the setback's corner, 2 cm apart, by their position. */
const spot = (i: number) => ({ across: 0.3 + i * 1.154, up: 0.3, landscape: false });
const spots = (count: number) => Array.from({ length: count }, (_, i) => spot(i));

/** The south face's grid with `count` modules. */
const laid = (count: number) => place(gridded, 0, spots(count));

const [first, second] = [spot(0), spot(1)];

test("a placed module lies where it is put, unwired, and wiring puts it into a string", () => {
  const placed = place(gridded, 0, [{ across: 2.5, up: 1, landscape: true }]);

  expect(placed.grids?.[0]?.modules).toEqual([
    { across: 2.5, up: 1, landscape: true, optimized: false },
  ]);

  const into = wire(placed, 0, 0, 1);

  expect(into.grids?.[0]?.modules).toEqual([
    { across: 2.5, up: 1, landscape: true, string: 1, optimized: false, order: 0 },
  ]);
  expect(wire(into, 0, 0).grids?.[0]?.modules).toEqual(placed.grids?.[0]?.modules);
});

test("a module moves to another place or turns, keeping its string; a removed one takes none along", () => {
  const wired = wire(laid(2), 0, 1, 0);
  const moved = move(wired, 0, 1, { across: 4, up: 2 });

  expect(moved.grids?.[0]?.modules[1]).toEqual({
    across: 4,
    up: 2,
    landscape: false,
    string: 0,
    optimized: false,
    order: 0,
  });
  expect(move(moved, 0, 1, { landscape: true }).grids?.[0]?.modules[1]).toMatchObject({
    across: 4,
    landscape: true,
    string: 0,
  });
  expect(move(wired, 0, 5, { across: 4 })).toEqual(wired);
  expect(removeModule(wired, 0, 0).grids?.[0]?.modules).toEqual([
    { ...second, string: 0, optimized: false, order: 0 },
  ]);
});

test("the modules a chimney stands on leave the scene; the others keep their order", () => {
  const two = place(addGrid(laid(3), 1, 0, 7), 1, spots(2));

  const cleared = uncovered(two, [
    [0, 1],
    [1, 0],
  ]);

  expect(cleared.grids?.map((grid) => grid.modules.map(({ across }) => across))).toEqual([
    [0.3, 0.3 + 2 * 1.154],
    [0.3 + 1.154],
  ]);
  expect(uncovered(two, [])).toBe(two);
});

test("fill face lays a module in every place the crate finds free, keeping the ones there", () => {
  const started = wire(laid(1), 0, 0, 0);
  const free = pv.fillFace({ scene: started, sizes: SIZES, grid: 0 });
  const filled = fillGrid(started, 0, free);

  // A 10 m wide, 4.883 m deep face behind a 0.3 m setback holds 8 × 2 portrait modules.
  expect(free).toHaveLength(15);
  expect(filled.grids?.[0]?.modules).toHaveLength(16);
  expect(filled.grids?.[0]?.modules[0]).toEqual({
    ...first,
    string: 0,
    optimized: false,
    order: 0,
  });
  expect(pv.modules(filled, SIZES).misplaced).toBeNull();
  expect(pv.fillFace({ scene: filled, sizes: SIZES, grid: 0 })).toEqual([]);
});

test("a filled landscape grid lays landscape modules", () => {
  const turned = editGrid(gridded, 0, { landscape: true });

  const filled = fillGrid(turned, 0, pv.fillFace({ scene: turned, sizes: SIZES, grid: 0 }));

  // 5 × 3 landscape modules.
  expect(filled.grids?.[0]?.modules).toHaveLength(15);
  expect(filled.grids?.[0]?.modules.every(({ landscape }) => landscape)).toBe(true);
});
