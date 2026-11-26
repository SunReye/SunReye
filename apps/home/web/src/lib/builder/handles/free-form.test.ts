/// <reference types="bun" />
import { expect, test } from "bun:test";
import { nextBlock } from "../../../../../../../packages/builder/src/builder/draft.ts";
import type { Block, Scene } from "../../../../../../../packages/builder/src/builder/pv.ts";
import {
  handles,
  type Target,
} from "../../../../../../../packages/builder/src/builder/handles/grips.ts";
import { offered } from "../../../../../../../packages/builder/src/builder/handles/offered.ts";
import { edges } from "../../../../../../../packages/builder/src/builder/handles/snapping.ts";

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

test("a free-form block's ring turns it, in the turn mode or beside an editor's; its knob carries it", () => {
  const laid = { walls: [], footings: [], panes: [], roofs: [] };

  const grips = (turning: boolean, ring = false) =>
    offered(scene(FREE), BLOCK, laid, turning, ring).map(({ grip }) => grip);

  expect(handles(scene(FREE), BLOCK).map(({ grip }) => grip)).toEqual(["turn", "move"]);
  expect(grips(false)).toEqual(["move", "carry"]);
  expect(grips(true)).toEqual(["turn"]);
  expect(grips(false, true)).toEqual(["turn", "move", "carry"]);

  // Before its southernmost corner, under its centroid, low over the ground.
  const knob = offered(scene(FREE), BLOCK, laid, false).find(({ grip }) => grip === "carry");

  expect(knob?.at.map((m) => Math.round(m * 1000) / 1000 + 0)).toEqual([1.333, 0.3, 4.8]);
});

test("a block dragged beside a free-form block snaps to no edge of its unused rectangle", () => {
  expect(edges(scene({ ...HOUSE, x: 30 }, FREE), BLOCK, 0)).toEqual([[], []]);
});

test("a picked free-form block shows its footprint on the ground, as a placed block does", () => {
  const outline = handles(scene(FREE), BLOCK).find(({ grip }) => grip === "move")?.outline;

  expect(outline).toEqual([
    [0, 0, 0],
    [0, 0, 4],
    [4, 0, 4],
  ]);
});

test("a mode offers its own handles alone: Move the outline and the knob, Resize the arrows", () => {
  const laid = { walls: [], footings: [], panes: [], roofs: [] };

  const grips = (mode: "move" | "resize") =>
    offered(scene(HOUSE), BLOCK, laid, false, true, mode).map(({ grip }) => grip);

  expect(grips("move")).toEqual(["move", "carry"]);
  expect(new Set(grips("resize"))).toEqual(new Set(["width", "depth", "pitch", "move"]));
});
