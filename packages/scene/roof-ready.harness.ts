// Ready roofs and special constructions traced by clicks, as the person does, and what they built
// read back.

import { placeRoof, type RoofSize, type Scene, setHeight } from "./index.js";
import { clicks, EMPTY, made } from "./roof.harness.ts";

/** The size every roof here is placed at: 10 m along x, 8 m along z, eaves at 3 m, top at 7 m. */
export const SIZE: RoofSize = { width: 10, depth: 8, eave: 3, ridge: 7 };

/** Clicks zoomed in, so a line 10 cm from another does not snap onto it. */
export const zoomed = (scene: Scene, ...spots: readonly (readonly [number, number])[]) =>
  clicks(scene, 0.02, ...spots);

/** Block `block`'s point at (x, z) seen from above. */
export function point(scene: Scene, x: number, z: number, block = 0): number {
  const found = (scene.blocks[block]?.freeForm?.traced?.points ?? []).findIndex(
    ([px = 0, , pz = 0]) => Math.hypot(px - x, pz - z) < 1e-6,
  );

  if (found < 0) throw new Error(`no point at ${x}, ${z}`);

  return found;
}

/** Block `block`'s line from (ax, az) to (bx, bz) seen from above, either way round. */
export function line(
  scene: Scene,
  [ax, az]: readonly number[],
  [bx, bz]: readonly number[],
  block = 0,
) {
  const [a, b] = [point(scene, ax ?? 0, az ?? 0, block), point(scene, bx ?? 0, bz ?? 0, block)];

  const found = (scene.blocks[block]?.freeForm?.traced?.lines ?? []).findIndex(
    ([p, q]) => (p === a && q === b) || (p === b && q === a),
  );

  if (found < 0) throw new Error(`no line from ${ax}, ${az} to ${bx}, ${bz}`);

  return found;
}

/** Block `block`'s height at (x, z). */
export function height(scene: Scene, x: number, z: number, block = 0): number {
  return scene.blocks[block]?.freeForm?.traced?.points[point(scene, x, z, block)]?.[1] ?? NaN;
}

/** A length rounded to the millimetre, without a negative zero. */
const mm = (v = 0) => Math.round(v * 1000) / 1000 + 0;

/** Block `block`'s faces, each as its corners x, y, z rounded to the millimetre, turned to start
 * at its least corner, and sorted: what was built, whatever order it was clicked in. */
export function built(scene: Scene, block = 0): string[] {
  return (scene.blocks[block]?.freeForm?.faces ?? [])
    .map((face) => {
      const corners = face.map(([x, y, z]) => `${mm(x)},${mm(y)},${mm(z)}`);
      const first = corners.indexOf(corners.toSorted()[0] ?? "");

      return [...corners.slice(first), ...corners.slice(0, first)].join(" ");
    })
    .toSorted();
}

/** A ready roof placed at the origin in an empty scene. */
export const placed = (id: string, size = SIZE) => made(placeRoof(EMPTY, id, { x: 0, z: 0 }, size));

/** The 10 m × 8 m outline clicked round. */
export const OUTLINE = [
  [0, 0],
  [10, 0],
  [10, 8],
  [0, 8],
  [0, 0],
] as const;

/** `scene` with block 0's points at each (x, z) set to `height`, as the person types it. */
export function typed(scene: Scene, to: number, ...spots: readonly (readonly [number, number])[]) {
  return spots.reduce((at, [x, z]) => made(setHeight(at, 0, point(at, x, z), to)), scene);
}
