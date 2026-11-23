/// <reference types="bun" />
import { expect, test } from "bun:test";
import { nextBlock } from "../../../../../../packages/builder/src/builder/draft.ts";
import type { Block, Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import {
  handles,
  type Target,
} from "../../../../../../packages/builder/src/builder/handles/grips.ts";
import { offered } from "../../../../../../packages/builder/src/builder/handles/offered.ts";
import { edges } from "../../../../../../packages/builder/src/builder/handles/snapping.ts";

// A free-form block's corner, size, eave, rotation and roof go unused (ADR 20): nothing is
// handled or snapped by them.

const HOUSE = nextBlock([]);

const FREE: Block = {
  ...HOUSE,
  freeForm: {
    footprint: [
      [0, 0],
      [0, 4],
      [4, 4],
    ],
    faces: [
      [
        [0, 3, 0],
        [0, 3, 4],
        [4, 3, 4],
      ],
    ],
  },
};

const scene = (...blocks: readonly Block[]): Scene => ({ north: 0, blocks, obstacles: [] });

const BLOCK: Target = { kind: "block", index: 0 };

test("a free-form block has no handles", () => {
  const laid = { walls: [], footings: [], panes: [], roofs: [] };

  expect(handles(scene(FREE), BLOCK)).toEqual([]);
  expect(offered(scene(FREE), BLOCK, laid, false)).toEqual([]);
  expect(offered(scene(FREE), BLOCK, laid, true)).toEqual([]);
});

test("a block dragged beside a free-form block snaps to no edge of its unused rectangle", () => {
  expect(edges(scene({ ...HOUSE, x: 30 }, FREE), BLOCK, 0)).toEqual([[], []]);
});
