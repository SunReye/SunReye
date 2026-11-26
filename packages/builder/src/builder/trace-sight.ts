// Whether the house hides a traced point from the camera (ADR 20 "Points"): seen in 3D, a point
// behind the roof is drawn faint and never grabbed, so a press takes what the person sees. A plan,
// seen straight down, hides none: a lower roof's points stay where it is traced.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js objects, read in place. */
import type { Spot } from "@sunreye/scene";
import { type Object3D, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { world } from "./handles/frame.ts";
import { CLEAR } from "./handles/sight.ts";
import type { Lens } from "./lens.ts";
import { projector } from "./project.ts";
import { pvPoint } from "./trace-aim.ts";
import type { Onscreen } from "./trace-pick.ts";

/** Whether a scene spot, in a scene turned `north` degrees, is in the camera's sight. */
export type Seen = (spot: Spot, north: number) => boolean;

const everywhere: Seen = () => true;

/** What `camera` sees past `house`; a plan's camera sees every point. */
export function sight(camera: Lens, house: Object3D | undefined): Seen {
  if (!(camera instanceof PerspectiveCamera) || house === undefined) return everywhere;

  const from = camera.getWorldPosition(new Vector3());

  return ([x, y, z], north) => {
    const to = new Vector3(...world(north, [x, y, z]));
    // A point may stand on the surface it belongs to, or just behind an edge: within a fingertip.
    const far = from.distanceTo(to) - CLEAR;

    if (far <= 0) return true;

    const ray = new Raycaster(from, to.clone().sub(from).normalize(), 0, far);

    return ray.intersectObject(house, true).length === 0;
  };
}

/** Where a scene spot, in a scene turned `north` degrees, lands on `canvas`; null where `house`
 * hides it from `camera`, or behind the camera. */
export function seenOnscreen(
  canvas: HTMLCanvasElement,
  camera: Lens,
  house: Object3D | undefined,
  north: number,
): Onscreen {
  const project = projector(canvas, camera);
  const seen = sight(camera, house);

  return (spot) => (seen(spot, north) ? project(pvPoint(north, spot)) : null);
}
