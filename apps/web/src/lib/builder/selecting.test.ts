/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { StringDraft } from "../api/core.ts";
import { addGrid, type Draft } from "./modules.ts";
import { place } from "./placing.ts";
import type { Scene } from "./pv.ts";
import { mostUnwired, toggled, unwired, wiredInto, wiredNew } from "./selecting.ts";

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

/** Portrait modules side by side from the setback's corner, 2 cm apart, by their position. */
const spot = (i: number) => ({ across: 0.3 + i * 1.154, up: 0.3, landscape: false });
const spots = (count: number) => Array.from({ length: count }, (_, i) => spot(i));

/** Four modules of type 7 on the south face, two of type 8 on the north. */
const scene = place(place(addGrid(addGrid(bare, 0, 1, 7), 0, 0, 8), 0, spots(4)), 1, spots(2));

const string = (name: string, moduleType: number): StringDraft => ({
  name,
  moduleType,
  device: 1,
  input: 2,
  modules: 0,
  optimized: 0,
  tilt: 0,
  azimuth: 0,
  loss: 2,
});

const draft: Draft = { scene, strings: [string("Süd", 7)] };
const cell = (module: number, grid = 0) => ({ grid, module });

/** Each module's string and place along it, by its position in the grid. */
const wiring = (of: Draft | null, grid = 0) =>
  of?.scene.grids?.[grid]?.modules.map((module) => [module.string ?? null, module.order ?? null]);

test("a tapped module joins the selection last, and a selected one leaves it", () => {
  expect(toggled([cell(2)], cell(0))).toEqual([cell(2), cell(0)]);
  expect(toggled([cell(2), cell(0), cell(1)], cell(0))).toEqual([cell(2), cell(1)]);
});

test("a selection is wired into a string in its own order, after the modules the string holds", () => {
  const first = wiredInto(draft, [cell(3)], 0);
  const more = first && wiredInto(first, [cell(1), cell(0)], 0);

  expect(wiring(more)).toEqual([
    [0, 2],
    [0, 1],
    [null, null],
    [0, 0],
  ]);
});

test("a selection holding another module type than the string is refused, and nothing is wired", () => {
  expect(wiredInto(draft, [cell(0), cell(0, 1)], 0)).toBeNull();
});

test("a selection is wired into a new string of its grid's module type, like the first string", () => {
  const made = wiredNew(draft, [cell(1, 1), cell(0, 1)], "String 2");

  expect(made?.strings[1]).toEqual({ ...string("String 2", 8), input: 1 });
  expect(wiring(made, 1)).toEqual([
    [1, 1],
    [1, 0],
  ]);
  // Two module types make no one string.
  expect(wiredNew(draft, [cell(0), cell(0, 1)], "String 2")).toBeNull();
});

test("unwiring a selection takes its modules out of their strings", () => {
  const wired = wiredInto(draft, [cell(0), cell(1), cell(2)], 0);

  expect(wiring(wired && unwired(wired, [cell(1), cell(3)]))).toEqual([
    [0, 0],
    [null, null],
    [0, 2],
    [null, null],
  ]);
});

test("the face with the most unwired modules is the one wiring starts on", () => {
  expect(mostUnwired(scene)).toEqual({ block: 0, face: 1 });

  const wired = wiredInto(draft, [cell(0), cell(1), cell(2)], 0);

  expect(wired && mostUnwired(wired.scene)).toEqual({ block: 0, face: 0 });
  expect(mostUnwired(bare)).toBeUndefined();
});
