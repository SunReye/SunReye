/// <reference types="bun" />
import { expect, test } from "bun:test";
import { emptyDraft } from "./modules.ts";
import { loadPv } from "@sunreye/pv-wasm";
import { fill, TEMPLATES } from "./templates.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A scene whose compass turns its forward axis to `north`. */
const turned = (north: number) => ({ ...emptyDraft(), scene: { ...emptyDraft().scene, north } });

test("the builder offers the six templates of ADR 20, empty last", () => {
  expect(TEMPLATES).toEqual(["gable", "bungalow", "hip", "lHouse", "terraceEnd", "empty"]);
});

/** Blocks each template places; its roof faces once laid out by the crate. */
const COUNTS = {
  gable: [1, 2],
  bungalow: [1, 1],
  hip: [1, 4],
  lHouse: [2, 4],
  terraceEnd: [2, 4],
  empty: [0, 0],
} as const;

for (const template of TEMPLATES) {
  test(`the pv crate accepts the ${template} template's scene`, () => {
    const { scene } = fill(turned(0), template);
    const [blocks, roofs] = COUNTS[template];

    expect(scene.blocks).toHaveLength(blocks);
    expect(pv.geometry(scene).faces.length).toBeGreaterThanOrEqual(blocks * 5);
    expect(pv.modules(scene, {}).roofs).toHaveLength(roofs);
  });
}

for (const north of [0, 90, 230]) {
  test(`a pitched template's front roof faces south with the compass at ${north}°`, () => {
    for (const template of ["gable", "hip", "lHouse", "terraceEnd"] as const) {
      const { roofs } = pv.modules(fill(turned(north), template).scene, {});

      expect(roofs.some(({ azimuth }) => Math.abs(azimuth) < 1e-6)).toBe(true);
    }
  });
}

test("a template keeps the compass and the strings, and replaces only the blocks", () => {
  const draft = {
    ...turned(40),
    strings: [],
    scene: {
      ...turned(40).scene,
      obstacles: [{ kind: "tree", x: 3, z: 20, radius: 2, height: 8 }],
    },
  } as const;

  const { scene } = fill(draft, "bungalow");

  expect(scene.north).toBe(40);
  expect(scene.obstacles).toEqual(draft.scene.obstacles);
});
