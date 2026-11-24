// Where a ready dormer lands (ADR 20): the traced face under a tap seen from above, a dormer's own
// faces passed over for the face it stands on. Pure.
import { dormers, type Click } from "@sunreye/scene";
import type { Scene } from "./pv.ts";

/** Whether (x, z) lies inside the polygon of `corners` seen from above. */
function inside(corners: readonly (readonly number[])[], { x, z }: Click): boolean {
  let crossings = 0;

  for (const [k, [ax = 0, , az = 0]] of corners.entries()) {
    const [bx = 0, , bz = 0] = corners[(k + 1) % corners.length] ?? [];

    if (az > z !== bz > z && x < ax + ((bx - ax) * (z - az)) / (bz - az)) crossings += 1;
  }

  return crossings % 2 === 1;
}

/** The traced face under `at` seen from above that is no dormer's own; undefined off every one. */
export function faceUnder(
  scene: Scene,
  at: Click,
): { readonly block: number; readonly face: number } | undefined {
  for (const [block, item] of scene.blocks.entries()) {
    const own = new Set(dormers(scene, block).flatMap((d) => d.faces));
    const faces = item.freeForm?.traced === undefined ? [] : item.freeForm.faces;
    const face = faces.findIndex((corners, f) => !own.has(f) && inside(corners, at));

    if (face >= 0) return { block, face };
  }

  return undefined;
}
