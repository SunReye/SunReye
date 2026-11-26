/// <reference types="bun" />
import { expect, test } from "bun:test";
import { PerspectiveCamera, Vector3 } from "three";
import { loadPv } from "@sunreye/pv-wasm";
import { picked } from "../../../../../../packages/builder/src/builder/levels.ts";
import type { Point, Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import {
  buildScene,
  strike,
  toThree,
} from "../../../../../../packages/builder/src/builder/scene.ts";

// A click on an obstacle names it by its position in the scene, so a consumer may remove a single
// tree by a click (ADR 20).

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

const scene: Scene = {
  north: 0,
  blocks: [
    {
      x: 20,
      z: 0,
      width: 4,
      depth: 4,
      eave: 2.5,
      rotation: 0,
      roof: { kind: "flat" },
      open: true,
    },
  ],
  obstacles: [
    { kind: "box", x: 0, z: 5, width: 4, depth: 0.5, height: 2, rotation: 0 },
    { kind: "tree", x: -6, z: 0, radius: 2, height: 8, crown: "broadleaf" },
    { kind: "hedge", x: 8, z: 8, length: 3, depth: 0.6, height: 1.5, rotation: 0 },
  ],
};

/** What a click from straight above `at` strikes. */
function from(above: Point): ReturnType<typeof strike> {
  const group = buildScene(pv.geometry(scene));

  // As a draw does, which places the crowns.
  group.updateMatrixWorld();
  const camera = new PerspectiveCamera(30, 1, 0.1, 500);
  const target = new Vector3(...toThree(above));

  camera.position.copy(target).add(new Vector3(0, 30, 0.01));
  camera.lookAt(target);
  camera.updateMatrixWorld();

  return strike(group, [], camera, [0, 0]);
}

/** The obstacle a click names, and the height it was struck at, to the decimetre: a crown is drawn faceted. */
function named(hit: ReturnType<typeof strike>): readonly [number, number] | undefined {
  return hit?.kind === "obstacle" ? [hit.index, Math.round(hit.point[2] * 10) / 10] : undefined;
}

test("a click on a box, a tree's crown or a hedge names the obstacle and the point struck", () => {
  expect(named(from([2, -5.25, 2]))).toEqual([0, 2]);
  expect(named(from([-6, 0, 8]))).toEqual([1, 8]);
  expect(named(from([9.5, -8.3, 1.5]))).toEqual([2, 1.5]);
});

test("the floor and a carport's roof are no obstacle", () => {
  expect(from([0, -20, 0])?.kind).toBe("point");
  expect(from([22, -2, 2.5])?.kind).toBe("point");
});

test("a click on an obstacle drills to it", () => {
  expect(picked(scene, { kind: "obstacle", index: 1, point: [-6, 0, 8] })).toEqual({
    kind: "obstacle",
    index: 1,
  });
});
