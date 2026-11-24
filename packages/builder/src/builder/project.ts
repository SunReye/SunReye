// Where a point of the scene lands on a canvas, as its camera draws it. Loads three.js.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import { type PerspectiveCamera, Vector3 } from "three";
import type { Point } from "./pv.ts";
import { toThree } from "./panels.ts";

/** Pixels from the canvas's top left corner. */
export type Projector = (point: Point) => readonly [number, number] | null;

export function projector(canvas: HTMLCanvasElement, camera: PerspectiveCamera): Projector {
  return (point) => {
    const at = new Vector3(...toThree(point)).project(camera);

    return at.z > 1
      ? null
      : [((at.x + 1) / 2) * canvas.clientWidth, ((1 - at.y) / 2) * canvas.clientHeight];
  };
}
