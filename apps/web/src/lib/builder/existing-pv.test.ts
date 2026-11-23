/// <reference types="bun" />
// Existing PV (ADR 20): modules already on a roof face that stay, drawn and kept clear of new ones.
import { expect, test } from "bun:test";
import { misplacedText } from "../../../../../packages/builder/src/builder/checks.ts";
import { addGrid, withoutBlock } from "../../../../../packages/builder/src/builder/modules.ts";
import { place } from "../../../../../packages/builder/src/builder/placing.ts";
import { loadPv } from "@sunreye/pv-wasm";
import type { ExistingPv, Point, Scene } from "../../../../../packages/builder/src/builder/pv.ts";
import { buildScene } from "../../../../../packages/builder/src/builder/scene.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

const SIZES = { 7: { width: 1.134, height: 1.722 } };

/** 2 m across and 1.8 m up the south face, its centre 3 m across and 2 m up. */
const FIELD: ExistingPv = { block: 0, face: 1, across: 3, up: 2, width: 2, length: 1.8 };

const block = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

/** A 10 m × 8 m gable house, eaves 3 m, pitched 35°, its front facing south, with existing PV. */
const scene: Scene = { north: 0, blocks: [block], obstacles: [], existingPv: [FIELD] };

/** The point of the scene `across` and `up` the south face, which rises 35° from (0, −8, 3). */
function onSouth(across: number, up: number): Point {
  const pitch = (35 * Math.PI) / 180;

  return [across, -8 + up * Math.cos(pitch), 3 + up * Math.sin(pitch)];
}

const mm = (point: readonly number[] = []) => point.map((metres) => Math.round(metres * 1000));

test("the crate lays existing PV on its face, and the scene draws it, casting no shadow", () => {
  const { existingPv } = pv.geometry(scene);

  expect(existingPv?.[0]?.map((corner) => mm(corner))).toEqual([
    mm(onSouth(2, 1.1)),
    mm(onSouth(4, 1.1)),
    mm(onSouth(4, 2.9)),
    mm(onSouth(2, 2.9)),
  ]);

  const drawn = buildScene(pv.geometry(scene)).getObjectsByProperty("name", "existingPv");

  // Its frame and, within it, its field.
  expect(drawn).toHaveLength(2);
  expect([drawn[0]?.castShadow, drawn[1]?.castShadow]).toEqual([false, false]);
});

test("existing PV off its face is not drawn", () => {
  const off: Scene = { ...scene, existingPv: [{ ...FIELD, across: 9.5 }] };

  expect(pv.geometry(off).existingPv).toBeNull();
  expect(buildScene(pv.geometry(off)).getObjectsByProperty("name", "existingPv")).toEqual([]);
});

test("a module on existing PV is misplaced, and its face shades the field as blocked", () => {
  // The second module spans 1.5 m to 2.634 m across: on the field.
  const moduled = place(addGrid(scene, 0, 1, 7), 0, [
    { across: 5, up: 0.5, landscape: false },
    { across: 1.5, up: 0.5, landscape: false },
  ]);

  const { misplaced, grids } = pv.modules(moduled, SIZES);

  expect(misplaced).toMatchObject({ kind: "existing", grid: 0, module: 1 });
  expect(misplaced && misplacedText(misplaced)).toBe(
    "Raster 1: Modul 2 liegt auf bestehenden Modulen.",
  );
  expect(grids[0]?.blocked).toHaveLength(1);
});

test("removing a block takes its existing PV, and a later block's moves down", () => {
  const two: Scene = {
    ...scene,
    blocks: [block, { ...block, x: 20 }],
    existingPv: [FIELD, { ...FIELD, block: 1 }],
  };

  expect(withoutBlock(two, 0).existingPv).toEqual([FIELD]);
});
