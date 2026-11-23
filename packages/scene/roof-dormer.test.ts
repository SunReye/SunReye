// Dormers (ADR 20): a closed loop traced inside a face is a dormer, its faces its own; the face
// around it keeps its place and its outline, and the house keeps its footprint.

import { expect, test } from "bun:test";
import { dormers, pullDormer, pullEaves, pullRidges, type Scene } from "./index.js";
import { EMPTY, grid, made, outlines, trace } from "./roof.harness.ts";

/** A 10 m square house, one face. */
const HOUSE = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
  [0, 0],
] as const;

/** A 2 m dormer inside it, clicked round. */
const DORMER = [
  [4, 4],
  [4, 6],
  [6, 6],
  [6, 4],
  [4, 4],
] as const;

const HOST = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

const OWN = [
  [4, 4],
  [4, 6],
  [6, 6],
  [6, 4],
];

test("a dormer traced inside a face is in its block, and the face around it stays it", () => {
  const scene = trace(trace(EMPTY, ...HOUSE), ...DORMER);

  expect(scene.blocks).toHaveLength(1);
  expect(outlines(scene)).toEqual([HOST, OWN]);
  expect(scene.blocks[0]?.freeForm?.footprint).toHaveLength(4);
});

test("a dormer joined to the face around it by one line leaves that face its face", () => {
  const scene = trace(trace(trace(EMPTY, ...HOUSE), ...DORMER), [0, 5], [4, 5]);

  expect(outlines(scene)).toEqual([
    [
      [0, 0],
      [0, 5],
      [0, 10],
      [10, 10],
      [10, 0],
    ],
    [
      [4, 4],
      [4, 5],
      [4, 6],
      [6, 6],
      [6, 4],
    ],
  ]);
  expect(scene.blocks[0]?.freeForm?.footprint).toHaveLength(5);
});

test("a dormer touching the face around it at one point leaves that face its face", () => {
  const scene = trace(trace(EMPTY, ...HOUSE), [0, 5], [3, 4], [3, 6], [0, 5]);

  expect(outlines(scene)).toEqual([
    [
      [0, 0],
      [0, 5],
      [0, 10],
      [10, 10],
      [10, 0],
    ],
    [
      [0, 5],
      [3, 6],
      [3, 4],
    ],
  ]);
});

/** A 10 m × 8 m gable, its ridge along x at z = 4, pulled to eaves at 3 m and ridge at 5 m: its
 * face toward −z rises half a metre each metre in. */
const PULLED = made(
  pullRidges(
    made(
      pullEaves(
        trace(trace(EMPTY, [0, 0], [0, 8], [10, 8], [10, 0], [0, 0]), [0, 4], [10, 4]),
        0,
        3,
      ),
    ),
    0,
    5,
  ),
);

/** The heights of block 0's points at `spots`, seen from above. */
function heights(scene: Readonly<Scene>, spots: readonly (readonly [number, number])[]): number[] {
  const points = scene.blocks[0]?.freeForm?.traced?.points ?? [];

  return spots.map(([x, z]) => points.find((p) => p[0] === x && p[2] === z)?.[1] ?? Number.NaN);
}

const CORNERS = [
  [4, 1],
  [4, 3],
  [6, 3],
  [6, 1],
] as const;

test("a dormer traced on a pulled roof lies on its face, and follows it when the house is pulled", () => {
  const traced = trace(PULLED, ...CORNERS, [4, 1]);

  expect(heights(traced, CORNERS)).toEqual([3.5, 4.5, 4.5, 3.5]);

  const steeper = made(pullRidges(traced, 0, 7));

  expect(heights(steeper, CORNERS)).toEqual([4, 6, 6, 4]);
});

test("each dormer is named with the face it stands on and its own faces", () => {
  const scene = trace(PULLED, ...CORNERS, [4, 1]);

  expect(dormers(scene, 0)).toEqual([{ face: 0, faces: [2] }]);
  expect(dormers(PULLED, 0)).toEqual([]);
});

test("a dormer's eaves are pulled to a height, but never below its face: a shed dormer", () => {
  const traced = trace(PULLED, ...CORNERS, [4, 1]);
  const pulled = made(pullDormer(traced, 0, 2, "eave", 4));

  // Its front corners stand at 4 m, its back corners stay on the face at 4.5 m.
  expect(heights(pulled, CORNERS)).toEqual([4, 4.5, 4.5, 4]);

  // The house pulled again: the raised front keeps its height, the back follows the face.
  expect(heights(made(pullRidges(pulled, 0, 7)), CORNERS)).toEqual([4, 6, 6, 4]);
});

test("a dormer's ridge is pulled apart from its eaves: a gable dormer", () => {
  // Its front from (4, 1) to (6, 1), its ridge from (5, 1) back to (5, 3), its sides back to (4, 2.5)
  // and (6, 2.5), where its eaves meet the face.
  const outline = trace(PULLED, [4, 1], [4, 2.5], [5, 3], [6, 2.5], [6, 1], [5, 1], [4, 1]);
  const traced = trace(outline, [5, 1], [5, 3]);
  const [dormer] = dormers(traced, 0);
  const eaves = made(pullDormer(traced, 0, dormer?.faces[0] ?? -1, "eave", 4.25));
  const pulled = made(pullDormer(eaves, 0, dormer?.faces[0] ?? -1, "ridge", 4.5));

  expect(
    heights(pulled, [
      [4, 1],
      [6, 1],
      [5, 1],
      [5, 3],
      [4, 2.5],
      [6, 2.5],
    ]),
  ).toEqual([4.25, 4.25, 4.5, 4.5, 4.25, 4.25]);
  expect(pullDormer(traced, 0, 0, "eave", 4)).toEqual({ refused: "missing" });
});

test("the edit that cuts a face drops its grid; its existing PV and the other face's grid stay", () => {
  const field = { block: 0, face: 0, across: 0.5, up: 0.5, width: 1, length: 1 };
  const placed: Scene = { ...PULLED, grids: [grid(0), grid(1)], existingPv: [field] };
  const cut = trace(placed, ...CORNERS, [4, 1]);

  expect(cut.grids).toEqual([grid(1)]);
  expect(cut.existingPv).toEqual([field]);

  const regridded: Scene = { ...cut, grids: [grid(0), grid(1)] };

  expect(made(pullDormer(regridded, 0, 2, "eave", 4)).grids).toEqual([grid(0), grid(1)]);
});
