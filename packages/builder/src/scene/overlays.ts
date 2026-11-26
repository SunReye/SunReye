// What is drawn over the scene rather than in it (ADR 20 "Look"): handles, rings and outlines.
// They stay out of the scene's own pass and the ambient occlusion's, so they neither cast nor take
// its shade, and are drawn after it.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js objects, marked in place. */
import type { Object3D } from "three";

const OVERLAY = "overlay";

/** Marks `object`, a child of the studio's scene, as drawn over the scene. */
export function asOverlay<T extends Object3D>(object: T): T {
  object.userData[OVERLAY] = true;

  return object;
}

/** The overlays a frame holds back from the scene's passes, and how to show them again. */
export interface HeldBack {
  readonly hidden: readonly Object3D[];
  readonly show: () => void;
}

/** Hides the overlays shown among `scene`'s children. */
export function hideOverlays(scene: Object3D): HeldBack {
  const hidden = scene.children.filter(
    (child) => child.visible && child.userData[OVERLAY] === true,
  );

  for (const child of hidden) child.visible = false;

  return {
    hidden,
    show: () => {
      for (const child of hidden) child.visible = true;
    },
  };
}
