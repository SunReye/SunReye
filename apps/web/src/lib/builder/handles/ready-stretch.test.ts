/// <reference types="bun" />
// A ready roof's arrows (ADR 20): a traced block on a rectangle carries a width and a depth arrow,
// which stretch it from the side across, as a block's do.
import { expect, test } from "bun:test";
import type { Block, Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import {
  drag,
  handles,
  type Ray,
  type Target,
} from "../../../../../../packages/builder/src/builder/handles/grips.ts";

/** A 6 m × 4 m flat roof traced on a rectangle, 3 m up. */
const footprint: readonly (readonly number[])[] = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
];

const READY: Block = {
  x: 0,
  z: 0,
  width: 0,
  depth: 0,
  eave: 0,
  rotation: 0,
  roof: { kind: "flat" },
  freeForm: { footprint, faces: [footprint.map((point) => [point[0] ?? 0, 3, point[1] ?? 0])] },
};

const scene = (block: Block): Scene => ({ north: 0, blocks: [block], obstacles: [] });

const BLOCK: Target = { kind: "block", index: 0 };

const down = (x: number, z: number): Ray => ({ origin: [x, 50, z], direction: [0, -1, 0] });

const rounded = (point: readonly number[] = []) =>
  point.map((m) => Math.round(m * 1000) / 1000 + 0);

test("a ready roof has its ring, a width arrow east of it and a depth arrow south of it", () => {
  const found = handles(scene(READY), BLOCK);

  expect(found.map(({ grip }) => grip)).toEqual(["turn", "move", "width", "depth"]);

  const [, , width, depth] = found;

  expect(rounded(width?.at)).toEqual([6.8, 0.3, 2]);
  expect(rounded(width?.axis)).toEqual([1, 0, 0]);
  expect(rounded(depth?.at)).toEqual([3, 0.3, 4.8]);
  expect(rounded(depth?.axis)).toEqual([0, 0, 1]);
});

test("its width arrow dragged 1.24 m east stretches it to 7.2 m, its west side staying", () => {
  const moved = drag(
    scene(READY),
    BLOCK,
    { grip: "width", ray: down(6.8, 2), height: 0.3 },
    down(8.04, 2),
  );

  expect(moved?.scene.blocks[0]?.freeForm?.footprint).toEqual([
    [0, 0],
    [7.2, 0],
    [7.2, 4],
    [0, 4],
  ]);
  expect(moved?.value).toEqual([7.2]);
  expect(moved?.unit).toBe("m");
});

test("a traced roof on no rectangle keeps its ring and its outline alone", () => {
  const triangle: Block = {
    ...READY,
    freeForm: {
      footprint: [
        [0, 0],
        [6, 0],
        [0, 4],
      ],
      faces: [],
    },
  };

  expect(handles(scene(triangle), BLOCK).map(({ grip }) => grip)).toEqual(["turn", "move"]);
});
