// The roof face a point of the scene lies on (ADR 25 "A roof face, in and out"): what a click on a
// roof selects, by its block and face, in every view of one scene. Free of three.js.
import type { RoofFaceId } from "@sunreye/scene";
import type { Point, RoofFace } from "./pv.ts";
import { cross, dot, type Vector } from "./vector.ts";

/** Metres off a face's plane a struck point may lie: the roof's drawn skin, not its outline. */
const ON = 0.05;

/** Whether `[x, y]` lies inside `outline`, by the even-odd rule. */
function inside(outline: RoofFace["outline"], [x, y]: readonly [number, number]): boolean {
  let within = false;

  for (const [i, [ax, ay]] of outline.entries()) {
    const [bx, by] = outline[(i + outline.length - 1) % outline.length] ?? [ax, ay];

    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) within = !within;
  }

  return within;
}

/** How far `point` lies off `roof`'s plane, if it lies over its outline; else Infinity. */
function offFace({ origin, across, up, outline }: RoofFace, point: Point): number {
  const from: Vector = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];

  return inside(outline, [dot(from, across), dot(from, up)])
    ? Math.abs(dot(from, cross(across, up)))
    : Infinity;
}

/** The face of `roofs` that `point`, east, north, up, lies on, or lies over within `within` metres
 * as a module's middle does; the nearest of several; null off every one. */
export function roofFaceAt(
  roofs: readonly RoofFace[],
  point: Point,
  within = ON,
): RoofFaceId | null {
  let nearest: RoofFace | undefined;
  let least = within;

  for (const roof of roofs) {
    const off = offFace(roof, point);

    if (off <= least) {
      nearest = roof;
      least = off;
    }
  }

  return nearest === undefined ? null : { block: nearest.block, face: nearest.face };
}
