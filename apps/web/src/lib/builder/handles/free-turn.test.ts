/// <reference types="bun" />
// The ring an editor offers beside the other handles (ADR 20): a traced block turns about its
// footprint's centroid as a drawn one about its centre; a turn settles lightly into the compass
// and other blocks' walls, Shift turns free, and a typed turn is exact.
import { describe, expect, test } from "bun:test";
import { turnBlock } from "@sunreye/scene";
import { nextBlock } from "../../../../../../packages/builder/src/builder/draft.ts";
import type { Block, Point, Scene } from "../../../../../../packages/builder/src/builder/pv.ts";
import {
  drag,
  handles,
  type Ray,
  type Target,
} from "../../../../../../packages/builder/src/builder/handles/grips.ts";
import { offered } from "../../../../../../packages/builder/src/builder/handles/offered.ts";
import { angleOf, turnedBy } from "@sunreye/builder/values";

const HOUSE = nextBlock([]);
const BLOCK: Target = { kind: "block", index: 0 };
const NONE = { walls: [], footings: [], panes: [], roofs: [] };

const traced: Block = {
  x: 0,
  z: 0,
  width: 0,
  depth: 0,
  eave: 0,
  rotation: 0,
  roof: { kind: "flat" },
  freeForm: {
    footprint: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    faces: [
      [
        [0, 3, 0],
        [4, 3, 0],
        [4, 3, 4],
        [0, 3, 4],
      ],
    ],
  },
};

const scene = (blocks: readonly Block[], north = 0): Scene => ({
  north,
  blocks,
  obstacles: [
    { kind: "box", x: 20, z: 0, width: 2, depth: 1, height: 2, rotation: 0 },
    { kind: "tree", x: -5, z: 10, radius: 2, height: 8 },
  ],
});

/** Straight down onto scene point `x`, `z` (north 0). */
const down = (x: number, z: number): Ray => ({
  origin: [x, 50, z],
  direction: [0, -1, 0],
});

/** Down onto the point `deg` degrees clockwise round `[cx, cz]`, `r` metres out. */
function round(cx: number, cz: number, deg: number, r = 5): Ray {
  const at = (deg * Math.PI) / 180;

  return down(cx + r * Math.cos(at), cz + r * Math.sin(at));
}

test("a traced block has a ring about its footprint's centroid, clear of its corners", () => {
  const [ring] = handles(scene([traced]), BLOCK);

  expect(ring?.grip).toBe("turn");
  expect(ring?.at).toEqual([2, 0, 2]);
  expect(ring?.radius).toBeGreaterThan(Math.hypot(2, 2));
});

const grips = (ring: boolean) =>
  offered(scene([HOUSE]), BLOCK, NONE, false, ring).map(({ grip }) => grip);

test("an editor's ring shows beside the other handles; out of it, Home's turn mode keeps it", () => {
  expect(grips(true)).toContain("turn");
  expect(grips(true)).toContain("move");
  expect(grips(false)).not.toContain("turn");
});

test("the ring turns a traced block about its centroid, what it carries with it", () => {
  const start = scene([traced]);

  const turned = drag(
    start,
    BLOCK,
    { grip: "turn", ray: round(2, 2, 0), height: 0, settle: "light" },
    round(2, 2, 37),
  );

  expect(turned?.value).toEqual([37]);
  expect(turned?.unit).toBe("°");
  expect(turned?.scene).toEqual(turnBlock(start, 0, 37));
});

test("a light turn settles within 3° of the compass, else on whole degrees", () => {
  const start = scene([HOUSE]);
  const [cx, cz] = [HOUSE.width / 2, HOUSE.depth / 2];

  const grab = {
    grip: "turn",
    ray: round(cx, cz, 0),
    height: 0,
    settle: "light",
  } as const;

  expect(drag(start, BLOCK, grab, round(cx, cz, 43.2))?.value).toEqual([45]);
  expect(drag(start, BLOCK, grab, round(cx, cz, 31.2))?.value).toEqual([31]);
});

test("a light turn settles on another block's walls; a traced one's longest edge counts", () => {
  const leaning = turnBlock(scene([HOUSE, { ...traced, x: 30 }]), 1, 33);
  const [cx, cz] = [HOUSE.width / 2, HOUSE.depth / 2];

  const grab = {
    grip: "turn",
    ray: round(cx, cz, 0),
    height: 0,
    settle: "light",
  } as const;

  expect(drag(leaning, BLOCK, grab, round(cx, cz, 31.6))?.value).toEqual([33]);
});

test("Shift turns free: no stop holds it, to a tenth of a degree", () => {
  const start = scene([HOUSE]);
  const [cx, cz] = [HOUSE.width / 2, HOUSE.depth / 2];

  const grab = {
    grip: "turn",
    ray: round(cx, cz, 0),
    height: 0,
    settle: "free",
  } as const;

  expect(drag(start, BLOCK, grab, round(cx, cz, 43.24))?.value).toEqual([43.2]);
});

test("a typed turn is exact: a block by its turn, a box about its centre, a tree not at all", () => {
  const start = scene([traced, HOUSE]);

  expect(turnedBy(start, BLOCK, 12.5)).toEqual(turnBlock(start, 0, 12.5));

  const box = turnedBy(start, { kind: "obstacle", index: 0 }, 90)?.obstacles[0];

  // The 2 by 1 box's centre, 21 and 0.5, stays.
  expect(box).toMatchObject({ rotation: 90, x: 21.5, z: -0.5 });
  expect(turnedBy(start, { kind: "obstacle", index: 1 }, 90)).toBeNull();
  expect(angleOf(start, { kind: "obstacle", index: 0 })).toBe(0);
  expect(angleOf(turnBlock(start, 1, 20), { kind: "block", index: 1 })).toBe(20);
  expect(angleOf(start, { kind: "obstacle", index: 1 })).toBeUndefined();
});

/** The crate, as far as a turn in a roof face asks it: nothing moves, everything stands. */
const STILL = {
  refit: () => ({ unfit: "room" as const }),
  glide: () => null,
  glideWindow: () => null,
  roofObjectsStand: () => true,
};

describe("a roof chimney and a roof window", () => {
  const CHIMNEY = { block: 0, face: 1, across: 5, up: 2, width: 0.6, depth: 0.6, height: 1 };
  const WINDOW = { block: 0, face: 1, across: 2, up: 2, width: 0.78, length: 1.18, turn: 350 };
  const roofed: Scene = { ...scene([HOUSE]), chimneys: [CHIMNEY], roofWindows: [WINDOW] };
  const chimney: Target = { kind: "chimney", index: 0 };

  // The crate's footing: a 0.6 m square round (5, -6) east and north, 4 m up.
  const foot: Point[] = [
    [4.7, -6.3, 4],
    [5.3, -6.3, 4],
    [5.3, -5.7, 4.4],
    [4.7, -5.7, 4.4],
  ];

  const footing = { foot, top: 5.4 };

  const laid = { ...NONE, footings: [footing] };

  test("turn in their face: typed exactly, read as their turn", () => {
    expect(angleOf(roofed, chimney)).toBe(0);
    expect(angleOf(roofed, { kind: "roofWindow", index: 0 })).toBe(350);
    expect(turnedBy(roofed, chimney, 30)?.chimneys?.[0]).toEqual({ ...CHIMNEY, turn: 30 });
    expect(turnedBy(roofed, { kind: "roofWindow", index: 0 }, 20)?.roofWindows?.[0]?.turn).toBe(10);
  });

  test("an editor's ring lies level round the footing's middle", () => {
    const ring = offered(roofed, chimney, laid, false, true).find(({ grip }) => grip === "turn");

    expect(ring?.at).toEqual([5, 4.2, 6]);
    expect(ring?.radius).toBeGreaterThan(Math.hypot(0.3, 0.3));
    expect(offered(roofed, chimney, laid, false).map(({ grip }) => grip)).not.toContain("turn");
  });

  /** The crate, as far as a turn asks it: nothing. */
  const crate = {
    pv: STILL,
    laid: { walls: [], roofs: [] },
  };

  test("the ring turns it in its face, settling lightly onto the eave's square and 45°", () => {
    const at = [5, 4.2, 6] as const;
    const grab = { grip: "turn", ray: round(5, 6, 0), height: 4.2, at, settle: "light" } as const;

    expect(drag(roofed, chimney, grab, round(5, 6, 37), crate)?.scene.chimneys?.[0]?.turn).toBe(37);
    expect(drag(roofed, chimney, grab, round(5, 6, 43.5), crate)?.value).toEqual([45]);
  });
});
