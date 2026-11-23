/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import {
  addLine,
  markLine,
  placeRoof,
  pullEaves,
  readyRoofs,
  setHeight,
  type Edited,
  type End,
  type Scene,
} from "@sunreye/scene";

// Ready roofs as the pv crate reads them (ADR 20): every face, the 10 cm steps too, is a roof the
// engine takes, and modules fill the roof's largest face.

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

const SIZES = { 1: { width: 1.134, height: 1.722 } };

/** The scene an edit made. */
function made(edited: Edited): Scene {
  if ("refused" in edited) throw new Error(edited.refused);

  return edited.scene;
}

/** A face's area on its slope: half the length of its edges' cross products summed (Newell). */
function area(face: readonly (readonly number[])[]): number {
  const sum = [0, 0, 0];

  for (const [k, [ax = 0, ay = 0, az = 0]] of face.entries()) {
    const [bx = 0, by = 0, bz = 0] = face[(k + 1) % face.length] ?? [];

    sum[0] = (sum[0] ?? 0) + ay * bz - az * by;
    sum[1] = (sum[1] ?? 0) + az * bx - ax * bz;
    sum[2] = (sum[2] ?? 0) + ax * by - ay * bx;
  }

  return Math.hypot(...sum) / 2;
}

/** Block 0's largest face, by its area on its slope. */
function largest(scene: Scene): number {
  const faces = scene.blocks[0]?.freeForm?.faces ?? [];

  return faces.reduce((best, face, k) => (area(face) > area(faces[best] ?? []) ? k : best), 0);
}

/** The roofs the engine reads in `scene`, and how many modules, landscape, it fills block 0's largest face
 * with. */
function read(scene: Scene) {
  const grid = {
    block: 0,
    face: largest(scene),
    moduleType: 1,
    landscape: true,
    setback: 0.3,
    modules: [],
  };

  const filled = pv.fillFace({ scene: { ...scene, grids: [grid] }, sizes: SIZES, grid: 0 });

  return { roofs: pv.modules(scene, SIZES).roofs.length, filled: filled.length };
}

test("every ready roof is read by the engine, each face a roof, and its largest face is filled", () => {
  for (const { id } of readyRoofs) {
    const scene = made(
      placeRoof(
        { north: 0, blocks: [], obstacles: [] },
        id,
        { x: 0, z: 0 },
        {
          width: 10,
          depth: 8,
          eave: 3,
          ridge: 7,
        },
      ),
    );

    const faces = scene.blocks[0]?.freeForm?.faces.length ?? 0;
    const { roofs, filled } = read(scene);

    expect([id, roofs]).toEqual([id, faces]);
    expect([id, filled > 0]).toEqual([id, true]);
    expect(pv.geometry(scene).faces.length).toBeGreaterThan(0);
  }
});

/** Clicks within 2 cm, zoomed in, each joined to the last. */
function zoomed(scene: Scene, ...clicks: readonly (readonly [number, number])[]): Scene {
  let at = scene;
  let from: End | undefined;

  for (const [x, z] of clicks) {
    if (from === undefined) from = { x, z };
    else {
      const edited = addLine(at, from, { x, z }, 0.02);

      at = made(edited);
      from = "refused" in edited ? from : { block: edited.block, point: edited.to };
    }
  }

  return at;
}

/** Block 0's point at (x, z). */
function point(scene: Scene, x: number, z: number): number {
  return (scene.blocks[0]?.freeForm?.traced?.points ?? []).findIndex(
    ([px = 0, , pz = 0]) => Math.hypot(px - x, pz - z) < 1e-6,
  );
}

/** Block 0's line between two points. */
function line(scene: Scene, a: number, b: number): number {
  return (scene.blocks[0]?.freeForm?.traced?.lines ?? []).findIndex(
    ([p, q]) => (p === a && q === b) || (p === b && q === a),
  );
}

test("a terrace cut into a ready roof is read by the engine: its concave face is filled", () => {
  const house = made(
    placeRoof(
      { north: 0, blocks: [], obstacles: [] },
      "satteldach",
      { x: 0, z: 0 },
      {
        width: 10,
        depth: 8,
        eave: 3,
        ridge: 7,
      },
    ),
  );

  const cut = zoomed(house, [3, 8], [3, 6], [7, 6], [7, 8]);
  const walls = zoomed(zoomed(cut, [3, 6], [3.1, 6.1], [6.9, 6.1], [7, 6]), [3, 8], [3.1, 6.1]);
  const traced = zoomed(walls, [6.9, 6.1], [7, 8]);

  const floor = [
    [3.1, 6.1, 6.9, 6.1],
    [3, 8, 3.1, 6.1],
    [6.9, 6.1, 7, 8],
  ].reduce((at, [ax = 0, az = 0, bx = 0, bz = 0]: readonly number[]) => {
    const which = line(at, point(at, ax, az), point(at, bx, bz));

    return made(markLine(at, 0, which, "eave"));
  }, traced);

  const level = made(pullEaves(floor, 0, 3));
  const back = made(setHeight(level, 0, point(level, 3, 6), 5));
  const terrace = made(setHeight(back, 0, point(back, 7, 6), 5));
  const { roofs, filled } = read(terrace);

  expect(roofs).toBe(6);
  expect(filled).toBeGreaterThan(0);
  expect(pv.geometry(terrace).faces.length).toBeGreaterThan(0);
});
