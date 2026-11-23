/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import {
  addLine,
  bent,
  pullEaves,
  pullRidges,
  setHeight,
  type End,
  type Edited,
  type Scene,
} from "@sunreye/scene";

// A traced roof as the pv crate reads it (ADR 20): the faces the tracing derives face up and
// carry modules, so the core would save them.

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

const RIDGE = 4 * Math.tan((35 * Math.PI) / 180) + 3;

/** Clicks on a surface at x, z and height, each joined to the last. */
function traced(scene: Scene, ...clicks: readonly (readonly [number, number, number])[]): Scene {
  let at = scene;
  let from: End | undefined;

  for (const [x, z, height] of clicks) {
    if (from === undefined) {
      from = { x, z, height };
      continue;
    }

    const edited = addLine(at, from, { x, z, height }, 0.3);

    if ("refused" in edited) throw new Error(edited.refused);

    at = edited.scene;
    from = { block: edited.block, point: edited.to };
  }

  return at;
}

test("a gable traced on a surface is two faces at its pitch, and a module lies on one", () => {
  const outline = traced(
    { north: 0, blocks: [], obstacles: [] },
    [0, 0, 3],
    [0, 4, RIDGE],
    [0, 8, 3],
    [10, 8, 3],
    [10, 4, RIDGE],
    [10, 0, 3],
    [0, 0, 3],
  );

  const gable = traced(outline, [0, 4, RIDGE], [10, 4, RIDGE]);

  const scene: Scene = {
    ...gable,
    grids: [
      {
        block: 0,
        face: 1,
        moduleType: 1,
        landscape: false,
        setback: 0.3,
        modules: [{ across: 1, up: 1, landscape: false }],
      },
    ],
  };

  const laid = pv.modules(scene, { 1: { width: 1.134, height: 1.722 } });

  expect(laid.roofs.map(({ tilt }) => Math.round(tilt))).toEqual([35, 35]);
  expect(laid.misplaced).toBeNull();
  expect(laid.grids[0]?.modules).toHaveLength(1);
});

/** The scene an edit made. */
function made(edited: Edited): Scene {
  if ("refused" in edited) throw new Error(edited.refused);

  return edited.scene;
}

/** Clicks on the plain ground from `from`, which bring no height, each joined to the last. */
function ground(scene: Scene, from: End, ...clicks: readonly (readonly [number, number])[]): Scene {
  let at = { scene, from };

  for (const [x, z] of clicks) {
    const edited = addLine(at.scene, at.from, { x, z }, 0.3);

    if ("refused" in edited) throw new Error(edited.refused);

    at = { scene: edited.scene, from: { block: edited.block, point: edited.to } };
  }

  return at.scene;
}

/** A module on face 1 of block 0. */
const ONE = {
  block: 0,
  face: 1,
  moduleType: 1,
  landscape: false,
  setback: 0.3,
  modules: [{ across: 1, up: 1, landscape: false }],
};

test("a gable traced on the plain ground and pulled up is two faces at its pitch, and carries modules", () => {
  const outline = ground(
    { north: 0, blocks: [], obstacles: [] },
    { x: 0, z: 0 },
    [0, 8],
    [10, 8],
    [10, 0],
    [0, 0],
  );

  const gable = ground(outline, { x: 0, z: 4 }, [10, 4]);
  const pulled = made(pullRidges(made(pullEaves(gable, 0, 3)), 0, RIDGE));

  const laid = pv.modules({ ...pulled, grids: [ONE] }, { 1: { width: 1.134, height: 1.722 } });

  expect(laid.roofs.map(({ tilt }) => Math.round(tilt))).toEqual([35, 35]);
  expect(laid.misplaced).toBeNull();
  expect(laid.grids[0]?.modules).toHaveLength(1);

  // A corner raised by hand bends its face: the engine keeps the roof and lays no module on it.
  const corner = (pulled.blocks[0]?.freeForm?.traced?.points ?? []).findIndex(
    ([x, , z]) => x === 0 && z === 8,
  );

  const raised = made(setHeight({ ...pulled, grids: [ONE] }, 0, corner, 4));

  expect(raised.grids).toEqual([]);
  expect(
    pv.modules({ ...raised, grids: [ONE] }, { 1: { width: 1.134, height: 1.722 } }).misplaced,
  ).not.toBeNull();
});

test("a bent traced face is drawn, offers no free roof, and bends exactly where the engine refuses it", () => {
  const outline = ground(
    { north: 0, blocks: [], obstacles: [] },
    { x: 0, z: 0 },
    [0, 8],
    [10, 8],
    [10, 0],
    [0, 0],
  );

  const gable = made(
    pullRidges(made(pullEaves(ground(outline, { x: 0, z: 4 }, [10, 4]), 0, 3)), 0, RIDGE),
  );

  const corner = (gable.blocks[0]?.freeForm?.traced?.points ?? []).findIndex(
    ([x, , z]) => x === 0 && z === 8,
  );

  const sizes = { 1: { width: 1.134, height: 1.722 } };

  const face = (gable.blocks[0]?.freeForm?.traced?.faces ?? []).findIndex((loop) =>
    loop.includes(corner),
  );

  const on = { ...ONE, face };

  // Raised by 1 cm to 20 cm: the face's corners stray from its plane by about a quarter of that.
  for (const by of [0.01, 0.06, 0.079, 0.081, 0.1, 0.2]) {
    const raised = made(setHeight(gable, 0, corner, 3 + by));
    const refused = pv.modules({ ...raised, grids: [on] }, sizes).misplaced !== null;

    expect([by, bent(raised, 0).includes(face)]).toEqual([by, refused]);
  }

  const bentRoof = made(setHeight(gable, 0, corner, 4));
  const empty = { ...on, modules: [] };

  expect(pv.geometry(bentRoof).faces.length).toBeGreaterThan(0);
  expect(pv.fillFace({ scene: { ...bentRoof, grids: [empty] }, sizes, grid: 0 })).toEqual([]);
});
