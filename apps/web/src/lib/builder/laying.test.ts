/// <reference types="bun" />
import { expect, test } from "bun:test";
import { picked } from "./levels.ts";
import { loadPv, type GridModule, type Point, type Scene } from "./pv.ts";

// What the crate answers while modules are laid (ADR 20 Modules), on the south face of a 10 m × 8 m
// gable house at 35°: 10 m across and 4.883 m up the slope, behind a 0.3 m setback.

const wasm = new URL(
  "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

const pv = await loadPv(await Bun.file(wasm).bytes());

const sizes = { 7: { width: 1.134, height: 1.722 } };

function gridded(modules: readonly GridModule[]): Scene {
  return {
    north: 0,
    blocks: [
      { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
    ],
    obstacles: [],
    grids: [{ block: 0, face: 1, moduleType: 7, landscape: false, setback: 0.3, modules }],
  };
}

/** A portrait module with its lower left corner `across` and `up` the south face. */
const portrait = (across: number, up: number): GridModule => ({ across, up, landscape: false });

/** The point of the scene `across` and `up` the south face, which rises 35° from (0, −8, 3). */
function onSouth(across: number, up: number): Point {
  const pitch = (35 * Math.PI) / 180;

  return [across, -8 + up * Math.cos(pitch), 3 + up * Math.sin(pitch)];
}

const mm = (metres: number): number => Math.round(metres * 1000);

test("the crate lays a grid out on its face: its modules, its setback and its chimneys", () => {
  const scene: Scene = {
    ...gridded([portrait(0.3, 0.3), { across: 1.454, up: 0.3, landscape: true }]),
    chimneys: [{ block: 0, face: 1, across: 5.5, up: 1.5, width: 0.6, depth: 0.6, height: 1 }],
  };

  const { roofs, grids, misplaced } = pv.modules(scene, sizes);

  expect(roofs.map(({ tilt, azimuth }) => [Math.round(tilt), Math.round(azimuth)])).toEqual([
    [35, 180],
    [35, 0],
  ]);
  expect(misplaced).toBeNull();

  const [grid] = grids;

  // The landscape module is 1.722 m across and 1.134 m up.
  expect(grid?.modules.map(({ area }) => area.flat().map((metres) => mm(metres)))).toEqual([
    [300, 300, 1434, 2022],
    [1454, 300, 3176, 1434],
  ]);
  expect(grid?.modules[0]?.corners[0]?.map((metres) => mm(metres))).toEqual(
    onSouth(0.3, 0.3).map((metres) => mm(metres)),
  );
  expect(grid?.outline).toHaveLength(4);
  expect(grid?.inset?.map((corner) => corner.map((metres) => mm(metres)))).toContainEqual(
    onSouth(0.3, 0.3).map((metres) => mm(metres)),
  );
  expect(grid?.blocked.map((foot) => foot[0]?.map((metres) => mm(metres)))).toEqual([
    onSouth(5.2, 1.5 - 0.3 / Math.cos((35 * Math.PI) / 180)).map((metres) => mm(metres)),
  ]);
});

/** The first module of a scene with `modules` and `chimneys` the core would refuse. */
const first = (modules: readonly GridModule[], chimneys: Scene["chimneys"] = []) =>
  pv.modules({ ...gridded(modules), chimneys }, sizes).misplaced;

test("a module beyond the setback, on another module or on a chimney comes back misplaced", () => {
  // Its top reaches past the face's 4.883 m less the setback.
  const beyond = first([portrait(0.3, 3.784)]);

  expect(beyond).toMatchObject({ kind: "setback", grid: 0, module: 0 });
  expect(
    (beyond && "area" in beyond ? beyond.area : null)?.flat().map((metres) => mm(metres)),
  ).toEqual([300, 3784, 1434, 5506]);
  expect(first([portrait(0.3, 0.3), portrait(1, 1)])).toMatchObject({ kind: "overlap", module: 1 });
  expect(
    first(
      [portrait(0.3, 0.3)],
      [{ block: 0, face: 1, across: 1, up: 1, width: 0.6, depth: 0.6, height: 1 }],
    ),
  ).toMatchObject({ kind: "chimney", module: 0 });
});

test("the crate lays the ghost module under a pointer, snapped to the module beside it", () => {
  const on = { scene: gridded([portrait(0.3, 0.3)]), sizes, grid: 0 };
  // The pointer holds the ghost's centre: 0.567 m across and 0.861 m up from its corner.
  const beside = onSouth(1.55 + 0.567, 0.42 + 0.861);

  const [ghost] = pv.lay(on, beside, beside) ?? [];

  expect([mm(ghost?.across ?? 0), mm(ghost?.up ?? 0), ghost?.landscape, ghost?.fits]).toEqual([
    1454,
    300,
    false,
    true,
  ]);
  expect(ghost?.corners[0]?.map((metres) => mm(metres))).toEqual(
    onSouth(1.454, 0.3).map((metres) => mm(metres)),
  );
  // On the module it shows where it would not fit; off the face it is none.
  expect(pv.lay(on, onSouth(1, 1.2), onSouth(1, 1.2))?.[0]?.fits).toBe(false);
  expect(pv.lay(on, [5, -2, 4.4], [5, -2, 4.4])).toBeNull();
});

test("a drag lays a row, a dragged module slides, and a chimney covers modules", () => {
  const scene = gridded([portrait(0.3, 0.3), portrait(3, 0.3)]);
  const on = { scene, sizes, grid: 0 };

  const row = pv.lay({ ...on, scene: gridded([]) }, onSouth(1.067, 1.361), onSouth(4.067, 1.5));

  expect(row?.map(({ across, fits }) => [mm(across), fits])).toEqual([
    [500, true],
    [1654, true],
    [2808, true],
  ]);

  const slid = pv.slide(on, 0, onSouth(1, 1), onSouth(2.5, 1.1));

  // 2 cm left of the other module, in line with it.
  expect([mm(slid?.across ?? 0), mm(slid?.up ?? 0), slid?.fits]).toEqual([1846, 300, true]);
  expect(pv.slide(on, 0, onSouth(1, 1), onSouth(3, 1.5))?.fits).toBe(false);
  expect(pv.slide(on, 7, onSouth(1, 1), onSouth(3, 1.5))).toBeNull();

  const chimneys = [{ block: 0, face: 1, across: 3.5, up: 1, width: 0.6, depth: 0.6, height: 1 }];

  expect(pv.covered({ ...scene, chimneys }, sizes)).toEqual([[0, 1]]);
  expect(pv.covered(scene, sizes)).toEqual([]);
});

test("a strike on a grid's face inside its setback drills to the face, in the setback to its block", () => {
  const scene = gridded([]);

  expect(pv.gridAt(scene, onSouth(5, 2))).toBe(0);
  expect(pv.gridAt(scene, onSouth(0.1, 2))).toBeNull();
  expect(picked(scene, { kind: "point", point: onSouth(5, 2) }, pv)).toEqual({
    kind: "face",
    block: 0,
    face: 1,
  });
  expect(picked(scene, { kind: "point", point: onSouth(0.1, 2) }, pv)).toEqual({
    kind: "block",
    index: 0,
  });
});
