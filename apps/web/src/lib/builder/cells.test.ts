/// <reference types="bun" />
import { expect, test } from "bun:test";
import { cellAt } from "./cells.ts";
import { addGrid } from "./modules.ts";
import { picked } from "./levels.ts";
import { loadPv, type Point, type Scene } from "./pv.ts";
import { fill } from "./templates.ts";
import { emptyDraft } from "./modules.ts";

const wasm = new URL(
  "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

const pv = await loadPv(await Bun.file(wasm).bytes());

/** The template's gable house, a grid of 1.134 m × 1.722 m modules on its south face. */
const scene: Scene = addGrid(fill(emptyDraft(), "gable").scene, 0, 1, 7);

const laid = pv.modules(scene, { 7: { width: 1.134, height: 1.722 } });

/** The centre of cell `row.column` of the south face. */
function centre(row: number, column: number): Point {
  const corners = laid.grids[0]?.find((c) => c.row === row && c.column === column)?.corners ?? [];
  const sum = corners.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);

  return [sum[0] / 4, sum[1] / 4, sum[2] / 4];
}

/** The point `u` across and `v` up the south face. */
function onSouth(u: number, v: number): Point {
  const roof = laid.roofs.find(({ face }) => face === 1);

  if (roof === undefined) throw new Error("no south face");

  const { origin: o, across: a, up: w } = roof;

  return [o[0] + a[0] * u + w[0] * v, o[1] + a[1] * u + w[1] * v, o[2] + a[2] * u + w[2] * v];
}

const strike = (point: Point) => picked(scene, { kind: "point", point }, laid.roofs, laid.grids);

test("a point on a roof face finds the grid's cell it lies in", () => {
  expect(cellAt(scene, laid, centre(1, 3))).toEqual({ grid: 0, row: 1, column: 3 });
  expect(cellAt(scene, laid, centre(0, 7))).toEqual({ grid: 0, row: 0, column: 7 });
});

test("a point in the setback, off the face's plane or on a face without a grid finds no cell", () => {
  const [east, north, up] = centre(0, 0);

  // 10 cm up from the eave, inside its 30 cm setback.
  expect(cellAt(scene, laid, onSouth(5, 0.1))).toBeNull();
  expect(cellAt(scene, laid, [east, north, up - 1])).toBeNull();
  // The north face mirrors the south one across the ridge.
  expect(cellAt(scene, laid, [east, -8 - north, up])).toBeNull();
});

test("a strike on a cell of a grid drills to its face, elsewhere on the roof to its block", () => {
  expect(strike(centre(1, 3))).toEqual({ kind: "face", block: 0, face: 1 });
  expect(strike(onSouth(5, 0.1))).toEqual({ kind: "block", index: 0 });
});
