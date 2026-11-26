/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import type { Scene } from "../../../../../../packages/builder/src/builder/pv.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A 10 m × 8 m house with 3 m walls under a 45° gable. */
const house: Scene = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 45 } },
  ],
  obstacles: [],
};

const window = {
  kind: "window",
  block: 0,
  wall: "front",
  along: 2,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
} as const;

/** 0.6 m square on the south face, 3 m across and 1.5 m up it. */
const chimney = { block: 0, face: 1, across: 3, up: 1.5, width: 0.6, depth: 0.6, height: 1.2 };

test("the crate lays out what the builder's handles stand on: walls and chimney footings", () => {
  const { walls, footings } = pv.modules(
    { ...house, chimneys: [chimney, { ...chimney, face: 9 }] },
    {},
  );

  // The front wall runs along z = 8 m, 8 m south; seen from outside, east is to the right.
  expect(walls).toHaveLength(1);
  expect(walls[0]?.front).toEqual({ left: [0, -8, 0], right: [1, 0, 0], out: [0, -1, 0] });
  expect(walls[0]?.left).toEqual({ left: [0, 0, 0], right: [0, -1, 0], out: [-1, 0, 0] });
  // Under a 45° gable its foot lies 0.3 m level either side of 1.5 m up the slope.
  expect(footings[0]?.foot).toHaveLength(4);
  expect(footings[0]?.foot[0]?.[0]).toBeCloseTo(2.7, 9);
  expect(footings[0]?.top).toBeCloseTo(3 + 1.5 * Math.SQRT1_2 + 0.3 + 1.2, 9);
  // One that names no roof face has none.
  expect(footings[1]).toBeNull();
});

test("the crate keeps a changed opening on its wall, or says why it cannot be", () => {
  const scene = { ...house, openings: [window, { ...window, along: 5 }] };

  expect(pv.refit(scene, 0, { ...window, along: 9.5 })).toEqual({
    opening: { ...window, along: 8.8 },
  });
  // A door stands on the ground, and says so.
  expect(pv.refit(scene, 0, { ...window, kind: "frontDoor" })).toEqual({
    opening: { ...window, kind: "frontDoor", sill: 0 },
  });
  expect(pv.refit(scene, 0, { ...window, along: 4 })).toEqual({ unfit: "overlap" });
  expect(pv.refit(scene, 0, { ...window, width: 30 })).toEqual({ unfit: "room" });
});

test("the crate finds a new opening's first free place, and none on a carport", () => {
  const usual = { width: 1.2, height: 1.4, sill: 0.9 };
  const carport = { ...house, blocks: house.blocks.map((block) => ({ ...block, open: true })) };

  expect(pv.place(house, "window", usual)).toEqual({ ...window, along: 0.5 });
  expect(pv.place(carport, "window", usual)).toBeNull();
});

test("the crate glides a chimney along its face and finds the one a strike lands on", () => {
  const scene = { ...house, chimneys: [chimney] };

  // 1 m north, seen from above, is √2 m up the 45° slope: 1.4 m in 10 cm steps.
  expect(pv.glide(scene, 0, [2, 1])).toEqual({ ...chimney, across: 5, up: 2.9 });
  expect(pv.glide(scene, 1, [2, 1])).toBeNull();
  // Its top stands at 5.561 m, over 6.939 m south.
  expect(pv.chimneyAt(scene, [3, -6.939, 5.5])).toBe(0);
  expect(pv.chimneyAt(scene, [5, -6.939, 4.1])).toBeNull();
});
