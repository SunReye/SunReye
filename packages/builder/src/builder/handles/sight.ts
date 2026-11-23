// Whether the scene hides a handle from the camera (ADR 20, mistaken drags): a hidden handle is
// neither drawn through the scene nor grabbed.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js objects, read in place. */
import { type Camera, type Object3D, Raycaster, Vector3 } from "three";

/** Metres behind the scene's surface a handle may lie and still be grabbed: a fingertip's reach,
 * for it may touch what it is on or stand close behind an edge. */
export const CLEAR = 0.6;

/** Whether `scene` stands between `camera` and `handle`'s place. */
export function hidden(handle: Object3D, camera: Camera, scene: Object3D): boolean {
  const from = camera.getWorldPosition(new Vector3());
  const to = handle.getWorldPosition(new Vector3());

  const sight = new Raycaster(
    from,
    to.clone().sub(from).normalize(),
    0,
    from.distanceTo(to) - CLEAR,
  );

  return sight.intersectObject(scene, true).length > 0;
}

/** How far along `ray` the scene first stands; nowhere, infinitely far. */
export function reachOf(ray: Raycaster, scene: Object3D | undefined): number {
  return scene === undefined
    ? Infinity
    : (ray.intersectObject(scene, true)[0]?.distance ?? Infinity);
}
