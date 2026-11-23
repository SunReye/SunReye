// Dormers (ADR 20): a closed loop traced inside a face is a dormer, its faces its own; the face
// around it keeps its place and its outline, and the house keeps its footprint.

import { expect, test } from "bun:test";
import { EMPTY, outlines, trace } from "./roof.harness.ts";

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
