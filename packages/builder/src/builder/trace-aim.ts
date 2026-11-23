// Where a pointer aims while tracing a roof (ADR 20): the plain ground under it in the scene's
// frame, how many metres a click's snap reaches there, and a scene spot in the pv crate's frame.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Click, Snap, Spot } from "@sunreye/scene";
import { type PerspectiveCamera, Raycaster, Vector2 } from "three";
import { inScene, level, world } from "./handles/frame.ts";
import { ndc } from "./pointer.ts";
import type { Point } from "./pv.ts";

/** A click on the canvas: where it lands, and the metres its snap reaches. */
export interface Aimed {
  readonly at: Spot;
  readonly reach: number;
  /** The traced point or line it picks by its pixels, as drawn; undefined over neither. */
  readonly snap?: Snap | undefined;
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

/** Where `event` lands on the plain ground, and the metres `pixels` reach there; null off the
 * ground. What it picks of the traced roof by pixels is `pick`'s (trace-pick.ts). A surface that
 * carries heights comes with tracing on it (ADR 20): a click then lands on it. */
export function aim(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  north: number,
  event: PointerEvent,
  pixels: number,
): Aimed | null {
  const at = ground(canvas, camera, north, event, [0, 0]);
  const beside = ground(canvas, camera, north, event, [pixels, 0]);

  if (at === null) return null;

  const reach = beside === null ? FALLBACK : Math.hypot(beside[0] - at[0], beside[2] - at[2]);

  return { at, reach };
}

/** A spot as a click: its height only when a surface gave one. */
export function clickAt([x, y, z]: Spot): Click {
  return y === 0 ? { x, z } : { x, z, height: y };
}
