/// <reference types="bun" />
// A traced roof turned whole (ADR 20): the crate lays its chimneys and modules where they stood,
// turned with it, on a level face and on a sloped one alike.
import { expect, test } from "bun:test";
import { centroidOf, turnBlock } from "@sunreye/scene";
import { loadPv } from "@sunreye/pv-wasm";
import type { Block, Point, Scene } from "../../../../../packages/builder/src/builder/pv.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

const sizes = { 7: { width: 1.134, height: 1.722 } };

/** A 10 m by 6 m traced roof from `x`, its eave 3 m up, its north side `high` metres up. */
function traced(x: number, high: number): Block {
  const footprint = [
    [x, 0],
    [x, 6],
    [x + 10, 6],
    [x + 10, 0],
  ];

  return {
    x: 0,
    z: 0,
    width: 0,
    depth: 0,
    eave: 0,
    rotation: 0,
    roof: { kind: "flat" },
    freeForm: {
      footprint,
      faces: [
        footprint.map((corner: readonly number[]) => {
          const [east = 0, z = 0] = corner;

          return [east, z === 0 ? high : 3, z];
        }),
      ],
    },
  };
}

const portrait = (across: number, up: number) => ({ across, up, landscape: false });

const scene: Scene = {
  north: 0,
  blocks: [traced(0, 3), traced(20, 5)],
  obstacles: [],
  chimneys: [0, 1].map((block) => ({
    block,
    face: 0,
    across: 6,
    up: 3,
    width: 0.6,
    depth: 0.6,
    height: 1,
  })),
  grids: [0, 1].map((block) => ({
    block,
    face: 0,
    moduleType: 7,
    landscape: false,
    setback: 0.3,
    modules: [portrait(0.5, 0.5), portrait(1.8, 0.5)],
  })),
};

/** `point` turned `by` degrees clockwise seen from above about scene point `[cx, cz]`. */
function turned([east, north, up]: Point, [cx, cz]: readonly number[], by: number): Point {
  const [sin, cos] = [Math.sin((by * Math.PI) / 180), Math.cos((by * Math.PI) / 180)];
  const [x, z] = [east - (cx ?? 0), -north - (cz ?? 0)];

  return [(cx ?? 0) + x * cos - z * sin, -((cz ?? 0) + x * sin + z * cos), up];
}

/** Points in an order that ignores where an outline starts: by their place to the centimetre. */
const key = (point: Point) => point.map((metres) => Math.round(metres * 100)).join(" ");

const settled = (points: readonly Point[]): readonly Point[] =>
  points.toSorted((a, b) => key(a).localeCompare(key(b)));

/** Whether `actual` lies on `expected`, point for point, within a millimetre. */
function same(actual: readonly Point[], expected: readonly Point[]) {
  expect(actual).toHaveLength(expected.length);

  for (const [index, point] of settled(actual).entries()) {
    for (const [axis, metres] of point.entries()) {
      expect(Math.abs(metres - (settled(expected)[index]?.[axis] ?? Number.NaN))).toBeLessThan(
        1e-3,
      );
    }
  }
}

for (const by of [37, 100, 200]) {
  test(`a traced roof turned ${by}° keeps its chimney and modules where they stood on it`, () => {
    const before = pv.modules(scene, sizes);
    const after = pv.modules(turnBlock(turnBlock(scene, 0, by), 1, by), sizes);

    expect(before.misplaced).toBeNull();
    expect(after.misplaced).toBeNull();

    for (const block of [0, 1]) {
      const middle = centroidOf(scene.blocks[block]?.freeForm?.footprint ?? []);
      const spin = (points: readonly Point[]) => points.map((p) => turned(p, middle, by));

      const corners = (laid: typeof before) =>
        laid.grids[block]?.modules.flatMap(({ corners: at }) => at) ?? [];

      same(after.footings[block]?.foot ?? [], spin(before.footings[block]?.foot ?? []));
      same(corners(after), spin(corners(before)));
    }
  });
}
