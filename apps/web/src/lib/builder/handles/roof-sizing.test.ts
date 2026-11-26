/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import type {
  Chimney,
  RoofWindow,
  Scene,
} from "../../../../../../packages/builder/src/builder/pv.ts";
import {
  drag,
  handles,
  type Ray,
  type Target,
} from "../../../../../../packages/builder/src/builder/handles/grips.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** 0.6 m square on the south face, its centre 3 m across and 1.5 m up. */
const CHIMNEY: Chimney = {
  block: 0,
  face: 1,
  across: 3,
  up: 1.5,
  width: 0.6,
  depth: 0.6,
  height: 1.2,
};

const WINDOW: RoofWindow = { block: 0, face: 1, across: 6, up: 2, width: 0.78, length: 1.18 };

/** A 10 m × 8 m gable house pitched 35°, its front facing south. */
const house = (chimney: Chimney = CHIMNEY): Scene => ({
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [],
  chimneys: [chimney],
  roofWindows: [WINDOW],
});

const COS = Math.cos((35 * Math.PI) / 180);

/** A ray straight onto the south face at `across` and `up` on it, in three.js's frame. */
function onto(scene: Scene, across: number, up: number): Ray {
  const south = pv.modules(scene, {}).roofs[1];

  if (south === undefined) throw new Error("no south face");

  const [e = 0, n = 0, u = 0] = south.origin.map(
    (from, axis) => from + (south.across[axis] ?? 0) * across + (south.up[axis] ?? 0) * up,
  );

  // The face's normal: up the sky and toward the south, as three.js has it.
  const normal = [0, COS, Math.sin((35 * Math.PI) / 180)] as const;

  return {
    origin: [e + normal[0] * 10, u + normal[1] * 10, -n + normal[2] * 10],
    direction: [-normal[0], -normal[1], -normal[2]],
  };
}

/** `target` in `scene` dragged by `grip` from `from` to `to` on the south face. */
function dragged(
  scene: Scene,
  target: Target,
  grip: "width" | "depth",
  [from, to]: readonly [readonly [number, number], readonly [number, number]],
) {
  const laid = pv.modules(scene, {});

  return drag(scene, target, { grip, ray: onto(scene, ...from), height: 0 }, onto(scene, ...to), {
    pv,
    laid,
  });
}

const CHIMNEY_AT: Target = { kind: "chimney", index: 0 };
const WINDOW_AT: Target = { kind: "roofWindow", index: 0 };

test("a chimney and a roof window carry an arrow at their right edge and one at their upper edge", () => {
  const scene = house();
  const laid = pv.modules(scene, {});

  for (const target of [CHIMNEY_AT, WINDOW_AT]) {
    const grips = handles(scene, target, laid).map(({ grip }) => grip);

    expect(grips).toEqual(["move", "width", "depth", "turn"]);
  }

  const [, width, depth] = handles(scene, CHIMNEY_AT, laid);

  expect(width?.axis?.map((m) => Math.round(m * 1000) / 1000 + 0)).toEqual([1, 0, 0]);
  // Up the slope: north is −z in three.js.
  expect(depth?.axis?.map((m) => Math.round(m * 1000) / 1000 + 0)).toEqual([0, 0.574, -0.819]);
});

test("its width grows from the edge dragged, the far edge staying, to whole centimetres", () => {
  const moved = dragged(house(), CHIMNEY_AT, "width", [
    [3.3, 1.5],
    [3.733, 1.5],
  ]);

  const chimney = moved?.scene.chimneys?.[0];

  expect(chimney?.width).toBe(1.03);
  expect(chimney?.across).toBeCloseTo(3.215, 6);
  expect(chimney?.up).toBe(1.5);
  expect(moved?.value).toEqual([1.03]);
  expect(moved?.unit).toBe("size");
});

test("its depth grows level up the slope, its centre moving half as far on the face", () => {
  const slope = 0.2 / COS;

  const moved = dragged(house(), CHIMNEY_AT, "depth", [
    [3, 1.8],
    [3, 1.8 + slope],
  ]);

  const chimney = moved?.scene.chimneys?.[0];

  expect(chimney?.depth).toBe(0.8);
  expect(chimney?.up).toBeCloseTo(1.5 + slope / 2, 5);
  expect(chimney?.across).toBe(3);
});

test("a turned chimney's arrows run along its own sides", () => {
  // Turned a quarter clockwise, its width runs down the slope.
  const scene = house({ ...CHIMNEY, turn: 90 });

  const moved = dragged(scene, CHIMNEY_AT, "width", [
    [3, 1.2],
    [3, 0.8],
  ]);

  const chimney = moved?.scene.chimneys?.[0];

  expect(chimney?.width).toBe(1);
  expect(chimney?.across).toBeCloseTo(3, 6);
  expect(chimney?.up).toBeCloseTo(1.3, 6);
});

test("a roof window's length grows up the slope; nothing shrinks below 10 cm", () => {
  const longer = dragged(house(), WINDOW_AT, "depth", [
    [6, 2.59],
    [6, 2.79],
  ]);

  expect(longer?.scene.roofWindows?.[0]).toEqual({ ...WINDOW, length: 1.38, up: 2.1 });

  const narrow = dragged(house(), CHIMNEY_AT, "width", [
    [3.3, 1.5],
    [1, 1.5],
  ]);

  expect(narrow?.scene.chimneys?.[0]?.width).toBe(0.1);
  expect(narrow?.scene.chimneys?.[0]?.across).toBeCloseTo(2.75, 6);
});

test("an arrow stops where its object would leave its face, and says it is at the edge", () => {
  // The chimney's right side, 3.3 m across, dragged 8 m east: the face ends at 10 m.
  const bare: Scene = { ...house(), roofWindows: [] };

  const moved = dragged(bare, CHIMNEY_AT, "width", [
    [3.3, 1.5],
    [11.3, 1.5],
  ]);

  const chimney = moved?.scene.chimneys?.[0];

  expect(chimney?.width).toBe(7.3);
  expect(chimney?.across).toBeCloseTo(6.35, 6);
  expect(moved?.value).toEqual([7.3]);
  expect(moved?.edge).toBe(true);
  expect(pv.roofObjectsStand(moved?.scene ?? bare)).toBe(true);
});

test("a roof window's arrow stops at the chimney beside it", () => {
  // The window 0.78 m wide at 6 m across; a chimney at 7.5 m, 7.2 m to 7.8 m.
  const scene: Scene = { ...house(), chimneys: [{ ...CHIMNEY, across: 7.5, up: 2 }] };

  const moved = dragged(scene, WINDOW_AT, "width", [
    [6.39, 2],
    [9, 2],
  ]);

  const window = moved?.scene.roofWindows?.[0];

  expect((window?.across ?? 0) + (window?.width ?? 0) / 2).toBeLessThanOrEqual(7.2);
  expect((window?.across ?? 0) + (window?.width ?? 0) / 2).toBeGreaterThan(7.18);
  expect(moved?.edge).toBe(true);
});
