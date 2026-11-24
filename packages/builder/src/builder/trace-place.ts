// Where a ready dormer lands (ADR 20): the traced face under a tap, as it is drawn, a dormer's own
// faces passed over for the face it stands on, and the place on it; and the dormer a picked line
// is a line of. Pure.
import { dormers, type Click, type Dormer } from "@sunreye/scene";
import { meet, type Ray, type Triple } from "./handles/frame.ts";
import type { Scene } from "./pv.ts";
import type { LineRef } from "./tracing.svelte.ts";

/** A traced face under a tap, and where on it seen from above. */
export interface Under {
  readonly block: number;
  readonly face: number;
  readonly at: { readonly x: number; readonly z: number };
}

/** Whether (x, z) lies inside the polygon of `corners` seen from above. */
function inside(corners: readonly (readonly number[])[], [x, , z]: Triple): boolean {
  let crossings = 0;

  for (const [k, [ax = 0, , az = 0]] of corners.entries()) {
    const [bx = 0, , bz = 0] = corners[(k + 1) % corners.length] ?? [];

    if (az > z !== bz > z && x < ax + ((bx - ax) * (z - az)) / (bz - az)) crossings += 1;
  }

  return crossings % 2 === 1;
}

/** The normal of the face of `corners` (Newell). */
function normalOf(corners: readonly (readonly number[])[]): Triple {
  const sum = [0, 0, 0];

  for (const [k, [ax = 0, ay = 0, az = 0]] of corners.entries()) {
    const [bx = 0, by = 0, bz = 0] = corners[(k + 1) % corners.length] ?? [];

    sum[0] = (sum[0] ?? 0) + (ay - by) * (az + bz);
    sum[1] = (sum[1] ?? 0) + (az - bz) * (ax + bx);
    sum[2] = (sum[2] ?? 0) + (ax - bx) * (ay + by);
  }

  return [sum[0] ?? 0, sum[1] ?? 0, sum[2] ?? 0];
}

/** Where the tap meets the face of `corners`: on its plane along `ray`, else the ground under it. */
function hit(corners: readonly (readonly number[])[], { x, z }: Click, ray?: Ray): Triple | null {
  const [cx = 0, cy = 0, cz = 0] = corners[0] ?? [];
  const on = ray === undefined ? ([x, 0, z] as const) : meet(ray, [cx, cy, cz], normalOf(corners));

  return on !== null && inside(corners, on) ? on : null;
}

/** Each traced face under a tap that is no dormer's own, with where the tap meets it. */
function under(scene: Scene, click: Click, ray?: Ray): (Under & { readonly up: number })[] {
  return scene.blocks.flatMap((item, block) => {
    const own = new Set(dormers(scene, block).flatMap((d) => d.faces));
    const faces = item.freeForm?.traced === undefined ? [] : item.freeForm.faces;

    return faces.flatMap((corners, face) => {
      const on = own.has(face) ? null : hit(corners, click, ray);

      return on === null ? [] : [{ block, face, at: { x: on[0], z: on[2] }, up: on[1] }];
    });
  });
}

/** The traced face highest under a tap, as seen from above, that is no dormer's own; undefined
 * off every one. */
export function faceUnder(scene: Scene, click: Click, ray?: Ray): Under | undefined {
  const [top] = under(scene, click, ray).toSorted((a, b) => b.up - a.up);

  return top && { block: top.block, face: top.face, at: top.at };
}

/** A picked dormer: its first face, its lowest and highest points' heights, its eaves' and its
 * ridges', and whether it has ridges: one of one face has none. */
export interface Picked {
  readonly face: number;
  readonly eave: number;
  readonly ridge: number;
  readonly ridged: boolean;
}

/** Whether `face`'s points hold both `ends`. */
const holds = (face: readonly number[] | undefined, ends: readonly number[]): boolean =>
  ends.length > 0 && ends.every((p) => face?.includes(p) === true);

/** Dormer `of`, read from its block's faces and points. */
function read(
  of: Dormer,
  faces: readonly (readonly number[])[],
  points: readonly (readonly number[])[],
): Picked {
  const heights = [...new Set(of.faces.flatMap((f) => faces[f] ?? []))].map(
    (p) => points[p]?.[1] ?? 0,
  );

  return {
    face: of.faces[0] ?? -1,
    eave: Math.min(...heights),
    ridge: Math.max(...heights),
    ridged: of.faces.length > 1,
  };
}

/** The dormer line `line` is a line of; undefined for a line of none. */
export function dormerOf(scene: Scene, { block, line }: LineRef): Picked | undefined {
  const traced = scene.blocks[block]?.freeForm?.traced;

  if (traced === undefined || traced === null) return undefined;

  const ends = traced.lines[line] ?? [];
  const of = dormers(scene, block).find((d) => d.faces.some((f) => holds(traced.faces[f], ends)));

  return of && read(of, traced.faces, traced.points);
}
