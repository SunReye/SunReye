/* oxlint-disable typescript/prefer-readonly-parameter-types -- a view, only read. */
// Where a point of the builder's scene lands on its canvas, for its component tests.
import { PerspectiveCamera, Vector3 } from "three";
import type { View } from "../../../../../packages/builder/src/builder/camera.ts";

export {
  faceView,
  presetView,
  type View,
} from "../../../../../packages/builder/src/builder/camera.ts";

/** Where a point lands on `canvas`, seen from `view`. */
export function onView(
  view: View,
  canvas: DOMRectReadOnly,
): (at: readonly [number, number, number]) => [number, number] {
  const camera = new PerspectiveCamera(40, canvas.width / canvas.height, 0.1, 5000);

  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  camera.updateMatrixWorld();

  return ([x, y, z]) => {
    const at = new Vector3(x, y, z).project(camera);

    return [
      canvas.left + ((at.x + 1) / 2) * canvas.width,
      canvas.top + ((1 - at.y) / 2) * canvas.height,
    ];
  };
}
