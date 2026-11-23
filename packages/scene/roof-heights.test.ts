// Pulling a traced roof up (ADR 20): the eaves to their height, then the ridges to theirs, which
// gives the pitches; every other point follows, and the faces stay flat.

import { expect, test } from "bun:test";
import {
  addLine,
  bent,
  lineKind,
  markLine,
  pullEaves,
  pullRidges,
  removeLine,
  setHeight,
  type Scene,
} from "./index.js";
import { EMPTY, grid, made, trace } from "./roof.harness.ts";

/** A 10 m × 8 m gable traced from above: the outline, then its ridge along x at z = 4. */
const GABLE = trace(trace(EMPTY, [0, 0], [0, 8], [10, 8], [10, 0], [0, 0]), [0, 4], [10, 4]);

/** Face `face` of block 0's pitch in degrees, from its corners' heights. */
function pitch(scene: Readonly<Scene>, face: number): number {
  const corners = scene.blocks[0]?.freeForm?.faces[face] ?? [];
  const ys = corners.map(([, y = 0]) => y);
  const zs = corners.map(([, , z = 0]) => z);
  const rise = Math.max(...ys) - Math.min(...ys);
  const run = Math.max(...zs) - Math.min(...zs);

  return (Math.atan2(rise, run) * 180) / Math.PI;
}

test("pulling a traced gable's eaves and ridges up gives the house the pitch that follows", () => {
  const ridge = 3 + 4 * Math.tan((35 * Math.PI) / 180);

  const pulled = made(pullRidges(made(pullEaves(GABLE, 0, 3)), 0, ridge));
  expect(heights(pulled)).toEqual([
    [0, 0, 3],
    [0, 4, ridge],
    [0, 8, 3],
    [10, 0, 3],
    [10, 4, ridge],
    [10, 8, 3],
  ]);
  expect(pitch(pulled, 0)).toBeCloseTo(35, 6);
  expect(pitch(pulled, 1)).toBeCloseTo(35, 6);
  expect(pulled.blocks[0]?.freeForm?.traced?.set).toBeUndefined();
});

/** Block 0's traced points as x, z and height, sorted by x then z. */
function heights(scene: Readonly<Scene>): number[][] {
  const points = scene.blocks[0]?.freeForm?.traced?.points ?? [];

  return points
    .map(([x = 0, y = 0, z = 0]) => [x, z, y])
    .toSorted(
      (p: readonly number[], q: readonly number[]) =>
        (p[0] ?? 0) - (q[0] ?? 0) || (p[1] ?? 0) - (q[1] ?? 0),
    );
}

/** Block 0's line from (x, z) to (x', z') seen from above, either way round. */
function lineAt(
  scene: Readonly<Scene>,
  [ax, az]: readonly number[],
  [bx, bz]: readonly number[],
): number {
  const { points = [], lines = [] } = scene.blocks[0]?.freeForm?.traced ?? {};

  const at = (p: number, x = 0, z = 0) => points[p]?.[0] === x && points[p]?.[2] === z;

  return lines.findIndex(
    ([a = -1, b = -1]) => (at(a, ax, az) && at(b, bx, bz)) || (at(a, bx, bz) && at(b, ax, az)),
  );
}

/** A 10 m × 8 m hip roof: the outline, its ridge from (3, 4) to (7, 4), and a hip to each corner. */
const HIP = trace(
  trace(trace(EMPTY, [0, 0], [0, 8], [10, 8], [10, 0], [0, 0]), [0, 0], [3, 4], [7, 4], [10, 0]),
  [0, 8],
  [3, 4],
  [7, 4],
  [10, 8],
);

test("the outline is taken for eaves and the highest inner lines for ridges; hips and valleys are neither", () => {
  expect(lineKind(HIP, 0, lineAt(HIP, [3, 4], [7, 4]))).toBe("ridge");
  expect(lineKind(HIP, 0, lineAt(HIP, [0, 0], [3, 4]))).toBeUndefined();
  expect(lineKind(HIP, 0, lineAt(HIP, [0, 0], [0, 8]))).toBe("eave");
  expect(lineKind(GABLE, 0, lineAt(GABLE, [0, 4], [10, 4]))).toBe("ridge");
  expect(lineKind(GABLE, 0, lineAt(GABLE, [0, 0], [0, 4]))).toBeUndefined();

  // An L of two gables: the valley runs from the inner corner (6, 6) to where the ridges meet.
  const ell = trace(
    trace(
      trace(EMPTY, [0, 0], [0, 12], [12, 12], [12, 6], [6, 6], [6, 0], [0, 0]),
      [3, 0],
      [3, 9],
      [12, 9],
    ),
    [6, 6],
    [3, 9],
  );

  expect(lineKind(ell, 0, lineAt(ell, [6, 6], [3, 9]))).toBeUndefined();
  expect(lineKind(ell, 0, lineAt(ell, [3, 0], [3, 9]))).toBe("ridge");
  expect(lineKind(ell, 0, lineAt(ell, [3, 9], [12, 9]))).toBe("ridge");
});

test("the person can make an eave a ridge: a mono-pitch roof's high side", () => {
  const box = trace(EMPTY, [0, 0], [0, 6], [8, 6], [8, 0], [0, 0]);
  const back = lineAt(box, [0, 0], [8, 0]);

  const marked = made(markLine(box, 0, back, "ridge"));
  const pulled = made(pullEaves(made(pullRidges(marked, 0, 5)), 0, 3));

  expect(lineKind(marked, 0, back)).toBe("ridge");
  expect(heights(pulled)).toEqual([
    [0, 0, 5],
    [0, 6, 3],
    [8, 0, 5],
    [8, 6, 3],
  ]);
  expect(pulled.blocks[0]?.freeForm?.traced?.ridges).toEqual([0, 3]);
});

test("a single point's height can be typed, and no pull changes it", () => {
  const pulled = made(pullRidges(made(pullEaves(GABLE, 0, 3)), 0, 6));

  const ridgeEnd = (pulled.blocks[0]?.freeForm?.traced?.points ?? []).findIndex(
    ([x, , z]) => x === 10 && z === 4,
  );

  const typed = made(setHeight(pulled, 0, ridgeEnd, 5.5));
  const again = made(pullRidges(made(pullEaves(typed, 0, 2.5)), 0, 7));

  expect(heights(again)).toEqual([
    [0, 0, 2.5],
    [0, 4, 7],
    [0, 8, 2.5],
    [10, 0, 2.5],
    [10, 4, 5.5],
    [10, 8, 2.5],
  ]);
  expect(again.blocks[0]?.freeForm?.traced?.set).toEqual([ridgeEnd]);
  // A ridge falling from 7 m to 5.5 m over level eaves can keep neither face flat.
  expect(bent(again, 0)).toEqual([0, 1]);
});

test("a pull keeps faces flat by moving the points that follow: a hip clicked in two", () => {
  // The hip from (0, 0) to (3, 4) clicked at its middle, (1.5, 2): that point follows.
  const clicked = trace(
    trace(
      trace(EMPTY, [0, 0], [0, 8], [10, 8], [10, 0], [0, 0]),
      [0, 0],
      [1.5, 2],
      [3, 4],
      [7, 4],
      [10, 0],
    ),
    [0, 8],
    [3, 4],
    [7, 4],
    [10, 8],
  );

  const pulled = made(pullRidges(made(pullEaves(clicked, 0, 3)), 0, 5));

  expect(heights(pulled)).toContainEqual([1.5, 2, 4]);
  expect(bent(pulled, 0)).toEqual([]);
});

test("a height that cannot keep a face flat bends it: it is named bent and its modules go", () => {
  const pulled: Scene = {
    ...made(pullRidges(made(pullEaves(GABLE, 0, 3)), 0, 6)),
    grids: [grid(0), grid(1)],
  };

  const corner = (pulled.blocks[0]?.freeForm?.traced?.points ?? []).findIndex(
    ([x, , z]) => x === 10 && z === 0,
  );

  const faceOf = (pulled.blocks[0]?.freeForm?.traced?.faces ?? []).findIndex((face) =>
    face.includes(corner),
  );

  const raised = made(setHeight(pulled, 0, corner, 4));

  expect(bent(raised, 0)).toEqual([faceOf]);
  expect(raised.grids).toEqual([grid(1 - faceOf)]);
});

test("a line drawn on a pulled roof lands on it, and its faces stay flat", () => {
  const pulled = made(pullRidges(made(pullEaves(GABLE, 0, 3)), 0, 6));

  const drawn = made(addLine(pulled, { x: 5, z: 4 }, { x: 5, z: 0 }, 0.3));

  expect(heights(drawn)).toContainEqual([5, 4, 6]);
  expect(heights(drawn)).toContainEqual([5, 0, 3]);
  expect(bent(drawn, 0)).toEqual([]);
});

test("a ridge the person makes an eave is pulled with the eaves", () => {
  const ridge = lineAt(GABLE, [0, 4], [10, 4]);

  const flatRoof = made(pullEaves(made(markLine(GABLE, 0, ridge, "eave")), 0, 3));

  expect(lineKind(flatRoof, 0, ridge)).toBe("eave");
  expect(heights(flatRoof).map((p: readonly number[]) => p[2])).toEqual([3, 3, 3, 3, 3, 3]);
});

test("a point that splits a line the person made a ridge is a ridge too", () => {
  const box = trace(EMPTY, [0, 0], [0, 6], [8, 6], [8, 0], [0, 0]);
  const marked = made(markLine(box, 0, lineAt(box, [0, 0], [8, 0]), "ridge"));

  // A line from the middle of the high side to the low side splits the ridge; removed again, it
  // leaves the point it split the ridge at, which no inner line ends at now.
  const split = made(addLine(marked, { x: 4, z: 0 }, { x: 4, z: 6 }, 0.3));
  const left = made(removeLine(split, 0, lineAt(split, [4, 0], [4, 6])));

  expect(lineKind(left, 0, lineAt(left, [0, 0], [4, 0]))).toBe("ridge");
  expect(lineKind(left, 0, lineAt(left, [4, 0], [8, 0]))).toBe("ridge");
});
