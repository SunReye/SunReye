// The turn mode's dial (ADR 20, mistaken drags): off the ring a drag turns the picked object by
// its travel sideways, wherever it starts. Pure.
import type { Scene } from "../pv.ts";
import { bodyOf } from "./body.ts";
import { level, type Ray, type Triple } from "./frame.ts";
import type { Laid, Target } from "./grips.ts";
import { offered } from "./offered.ts";

/** Degrees the dial turns for each pixel the pointer goes sideways: a quarter turn in 180 px. */
export const PER_PIXEL = 0.5;

/** What the dial turns: the scene, what is picked in it and what the crate laid out for it. */
export interface Dialled {
  readonly scene: Scene;
  readonly target: Target;
  readonly laid: Laid;
}

/** The turn of what is picked, in degrees; none for what has no turn. */
export function turnOf({ scene, target }: Dialled): number | undefined {
  const body = bodyOf(scene, target);

  return body?.kind === "rect" ? body.rotation : undefined;
}

/** Which way the dial turns for a press along `ray`, seen by a camera looking `ahead`: what is
 * under the pointer follows it. Where the ray meets the ground before the object's middle a pixel
 * to the right is against the clock, −1; beyond the middle, or in the sky, with it, 1. */
export function sense({ scene, target, laid }: Dialled, ray: Ray, ahead: Triple): -1 | 1 {
  const [ring] = offered(scene, target, laid, true);
  const ground = level(ray, 0);

  if (ring === undefined || ground === null) return 1;

  const [east, south] = [ground[0] - ring.at[0], ground[2] - ring.at[2]];

  return east * ahead[0] + south * ahead[2] > 0 ? 1 : -1;
}
