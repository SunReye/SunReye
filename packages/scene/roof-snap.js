// What a click on a traced roof snaps to (ADR 20), and a block's lines as an edit reads them. Pure.

import { along, apart, between } from "./roof-plan.js";

/** @import { Block, Scene } from "./schema.d.ts" */
/** @import { Click, Snap, Spot } from "./roof.d.ts" */
/** @import { Lines } from "./roof-faces.js" */

/** A block without lines. */
const UNTRACED = { points: [], set: [], lines: [], faces: [], eaves: [], ridges: [] };

/**
 * A block's traced part; empty for a block without one.
 * @param {Block | undefined} block
 * @returns {Lines}
 */
export function linesOf(block) {
  const traced = block?.freeForm?.traced ?? UNTRACED;
  const { points, set = [], lines, faces, eaves = [], ridges = [] } = traced;

  return { points, set, lines, faces, eaves, ridges };
}

/**
 * A place as a spot.
 * @param {readonly number[]} p
 * @returns {Spot}
 */
export const spot = (p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];

/**
 * The traced point nearest `at` within `reach` metres seen from above, if any.
 * @param {Scene} scene
 * @param {readonly number[]} at
 * @param {number} reach
 * @returns {Snap | undefined}
 */
function nearPoint(scene, at, reach) {
  /** @type {Snap | undefined} */
  let found;
  let nearest = reach;

  for (const [block, item] of scene.blocks.entries())
    for (const [point, p] of linesOf(item).points.entries())
      if (apart(p, at) <= nearest) {
        nearest = apart(p, at);
        found = { kind: "point", block, point, at: spot(p) };
      }

  return found;
}

/**
 * The place on a traced line nearest `at` within `reach` metres seen from above, if any.
 * @param {Scene} scene
 * @param {readonly number[]} at
 * @param {number} reach
 * @returns {Snap | undefined}
 */
function nearLine(scene, at, reach) {
  /** @type {Snap | undefined} */
  let found;
  let nearest = reach;

  for (const [block, item] of scene.blocks.entries()) {
    const { points, lines } = linesOf(item);

    for (const [line, [i = 0, j = 0]] of lines.entries()) {
      const p = points[i] ?? [];
      const q = points[j] ?? [];
      const on = between(p, q, Math.min(1, Math.max(0, along(at, p, q))));

      if (apart(on, at) <= nearest) {
        nearest = apart(on, at);
        found = { kind: "line", block, line, at: on };
      }
    }
  }

  return found;
}

/**
 * @param {Scene} scene
 * @param {Click} click
 * @param {number} reach
 * @returns {Snap}
 */
export function snap(scene, click, reach) {
  const at = [click.x, 0, click.z];

  return (
    nearPoint(scene, at, reach) ??
    nearLine(scene, at, reach) ?? { kind: "free", at: [click.x, click.height ?? 0, click.z] }
  );
}
