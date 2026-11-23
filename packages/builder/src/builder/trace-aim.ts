// Where a pointer aims while tracing a roof (ADR 20): the plain ground under it in the scene's
// frame, how many metres a click's snap reaches there, and a scene spot in the pv crate's frame.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Click, Spot } from "@sunreye/scene";
import { type PerspectiveCamera, Raycaster, Vector2 } from "three";
import { inScene, level, world } from "./handles/frame.ts";
import { ndc } from "./pointer.ts";
import type { Point } from "./pv.ts";

/** A click on the canvas: where it lands, and the metres its snap reaches. */
export interface Aimed {
  readonly at: Spot;
  readonly reach: number;
}

/** Metres a click snaps within where the ground cannot be measured. */
const FALLBACK = 0.3;

/** A spot of the scene in the pv crate's frame: east, north, up. */
export function pvPoint(north: number, spot: readonly number[]): Point {
  const [east, up, south] = world(north, [spot[0] ?? 0, spot[1] ?? 0, spot[2] ?? 0]);

  return [east, 0 - south, up];
}

/** Where the canvas point `shift` pixels off `event` lands on the plain ground; null off it. */
function ground(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  north: number,
  event: PointerEvent,
  [dx, dy]: readonly [number, number],
): Spot | null {
  // A press may come before the first draw has placed the camera's matrices.
  camera.updateMatrixWorld();

  const [x, y] = ndc(canvas, event);
  const box = canvas.getBoundingClientRect();
  const ray = new Raycaster();

  ray.setFromCamera(new Vector2(x + (dx / box.width) * 2, y - (dy / box.height) * 2), camera);

  const { origin, direction } = ray.ray;
  const on = level(inScene(north, { origin: origin.toArray(), direction: direction.toArray() }), 0);

  return on && [on[0], on[1], on[2]];
}

/** Where `event` lands, at the height `height` gives there if any, and the metres `pixels`
 * reach there; null off the ground. */
export function aim(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  north: number,
  event: PointerEvent,
  {
    pixels,
    height,
  }: {
    readonly pixels: number;
    readonly height?: ((x: number, z: number) => number | undefined) | undefined;
  },
): Aimed | null {
  const at = ground(canvas, camera, north, event, [0, 0]);
  const beside = ground(canvas, camera, north, event, [pixels, 0]);

  if (at === null) return null;

  const reach = beside === null ? FALLBACK : Math.hypot(beside[0] - at[0], beside[2] - at[2]);
  const up = height?.(at[0], at[2]);

  return { at: up === undefined ? at : [at[0], up, at[2]], reach };
}

/** A spot as a click: its height only when a surface gave one. */
export function clickAt([x, y, z]: Spot): Click {
  return y === 0 ? { x, z } : { x, z, height: y };
}
