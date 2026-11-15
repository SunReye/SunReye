// Where a pointer aims in the drawn scene (ADR 20): what its ray strikes first, and where it meets
// a roof face's plane, which a drag follows past the face's edge.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import { type Camera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { toThree } from "./panels.ts";
import type { Point, RoofFace } from "./pv.ts";
import type { Hit } from "./strike.ts";

/** A pointer's aim, each answer worked out when asked. */
export interface Aim {
  /** The pointer on the page, in pixels. */
  readonly at: readonly [number, number];
  /** What the pointer's ray strikes first; null for nothing. */
  readonly hit: () => Hit | null;
  /** Where the pointer's ray meets the plane of `roof`: east, north, up; null where it runs
   * along it or away from it. */
  readonly onFace: (roof: RoofFace) => Point | null;
}

/** Where the ray from `camera` through `at` (−1 to 1 across the canvas, y up) meets the plane of
 * `roof`, in the crate's frame. */
export function onPlane(
  camera: Camera,
  at: readonly [number, number],
  { origin, across, up }: RoofFace,
): Point | null {
  const ray = new Raycaster();

  ray.setFromCamera(new Vector2(...at), camera);

  const normal = new Vector3(...toThree(across)).cross(new Vector3(...toThree(up))).normalize();
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(...toThree(origin)));
  const met = ray.ray.intersectPlane(plane, new Vector3());

  return met === null ? null : [met.x, 0 - met.z, met.y];
}
