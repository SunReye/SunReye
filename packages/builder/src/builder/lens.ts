// The canvas's camera by its navigation (ADR 20 "Navigation"): a plan is drawn in parallel
// projection, as a plan on paper is, the builder's own views in perspective.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js shapes its cameras in place. */
import { OrthographicCamera, PerspectiveCamera, type Vector3 } from "three";
import { FOV } from "./camera.ts";
import type { Navigation } from "./navigation.ts";

/** A camera the canvas draws through. */
export type Lens = PerspectiveCamera | OrthographicCamera;

/** Metres from the camera of the nearest and the furthest it draws. */
const NEAR = 0.1;
const FAR = 5000;

export function lensOf(navigation: Navigation): Lens {
  return navigation === "plan"
    ? new OrthographicCamera(-1, 1, 1, -1, NEAR, FAR)
    : new PerspectiveCamera(FOV, 1, NEAR, FAR);
}

/** Shapes `lens` for a canvas `aspect` wide, looking at `target`. A parallel one shows at its
 * target what a perspective one standing there would, and turns the controls' zoom into its
 * distance: a view of it stays where it stands and what it looks at. */
export function fitLens(lens: Lens, aspect: number, target: Vector3): void {
  if (lens instanceof PerspectiveCamera) {
    lens.aspect = aspect;
    lens.updateProjectionMatrix();

    return;
  }

  if (lens.zoom !== 1) {
    lens.position.sub(target).divideScalar(lens.zoom).add(target);
    lens.zoom = 1;
  }

  const half = lens.position.distanceTo(target) * Math.tan(((FOV / 2) * Math.PI) / 180);

  Object.assign(lens, { top: half, bottom: -half, left: -half * aspect, right: half * aspect });
  lens.updateProjectionMatrix();
}
