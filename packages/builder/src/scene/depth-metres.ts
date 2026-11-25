// Metres from the camera of a depth the scene drew, for either lens (ADR 20 "Navigation"): a plan's
// parallel camera stores depth linearly, a perspective one does not. Needs `<packing>`.
import { OrthographicCamera } from "three";
import type { Lens } from "../builder/lens.ts";

export const DEPTH_METRES = `
  float metresAt(float depth, float near, float far) {
  #ifdef PARALLEL
    return -orthographicDepthToViewZ(depth, near, far);
  #else
    return -perspectiveDepthToViewZ(depth, near, far);
  #endif
  }
`;

/** The defines a pass reading depth through `metresAt` takes for `lens`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
export const depthDefines = (lens: Lens): Record<string, string> =>
  lens instanceof OrthographicCamera ? { PARALLEL: "" } : {};
