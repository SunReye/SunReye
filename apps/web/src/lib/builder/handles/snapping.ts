// Snapping beyond the 10 cm and 5° steps (ADR 20): edges to other blocks' parallel edges, turns
// to the compass axes and to other blocks' turns. Pure.
import type { Scene } from "../pv.ts";
import type { Target } from "./body.ts";
import { on } from "./body.ts";
import { snap, turn } from "./frame.ts";

/** An edge this close to another block's edge, in metres, snaps to it. */
const EDGE = 0.25;
/** A turn this close to the compass or another block's, in degrees, snaps to it. */
const ALIGN = 3;
/** Any other turn snaps to this step, in degrees. */
const ANGLE = 5;

/** Across (u) and deep (w) along axes turned by `rotation`, from the scene's origin. */
export function along(rotation: number, x: number, z: number): [number, number] {
  return turn(x, z, -rotation);
}

const others = (scene: Scene, target: Target) =>
  scene.blocks.filter((_, i) => target.kind !== "block" || i !== target.index);

/** The other blocks' edges parallel to `rotation`, as `along` places them: across, then deep. */
export function edges(scene: Scene, target: Target, rotation: number): [number[], number[]] {
  const across: number[] = [];
  const deep: number[] = [];

  for (const block of others(scene, target)) {
    const skew = (((block.rotation - rotation) % 90) + 90) % 90;

    if (Math.min(skew, 90 - skew) < 0.5) {
      for (const [u, w] of [
        [0, 0],
        [block.width, 0],
        [block.width, block.depth],
        [0, block.depth],
      ] as const) {
        const [x, , z] = on(block, u, 0, w);
        const [a, b] = along(rotation, x, z);

        across.push(a);
        deep.push(b);
      }
    }
  }

  return [across, deep];
}

/** How far to shift `own` edges onto the closest of `found` within 25 cm; 0 for none. */
export function pull(own: readonly number[], found: readonly number[]): number {
  let best = 0;

  for (const mine of own) {
    for (const edge of found) {
      const gap = edge - mine;

      if (Math.abs(gap) <= EDGE && (best === 0 || Math.abs(gap) < Math.abs(best))) best = gap;
    }
  }

  return best;
}

/** A turn snapped to the compass axes or another block's turn within 3°, else to 5°. */
export function snapTurn(scene: Scene, target: Target, rotation: number): number {
  // The scene's north turns everything: a block turned by −north stands on the compass.
  const rests = [-scene.north, ...others(scene, target).map((block) => block.rotation)];

  for (const rest of rests) {
    const off = ((((rotation - rest) % 90) + 135) % 90) - 45;

    if (Math.abs(off) <= ALIGN) return rotation - off;
  }

  return snap(rotation, ANGLE);
}
