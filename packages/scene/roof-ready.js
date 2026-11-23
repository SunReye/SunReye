// Ready roofs (ADR 20): each placed in one click as the lines a person could have traced, clicked
// with `addLine`, then marked, set and pulled up with the tools a person has. Pure.

import { addLine } from "./roof.js";
import { markLine, pullEaves, pullRidges, setHeight } from "./roof-pull.js";
import { apart } from "./roof-plan.js";
import { ROOFS } from "./roof-ready-plans.js";
import { linesOf } from "./roof-snap.js";

/** @import { Scene } from "./schema.d.ts" */
/** @import { Edited, End, RoofSize } from "./roof.d.ts" */
/** @import { Flat, Plan } from "./roof-ready-plans.js" */

/** @typedef {(scene: Scene, last: Edited) => Edited} Edit */

/** Metres a click snaps within: only onto a point or line the roof itself already has. */
const REACH = 1e-6;

export const readyRoofs = ROOFS.map(({ id, de, en }) => ({ id, de, en }));

/**
 * Block `block`'s point at `at` seen from above; -1 for none.
 * @param {Scene} scene
 * @param {number} block
 * @param {Flat} at
 * @returns {number}
 */
function pointAt(scene, block, [x, z]) {
  return linesOf(scene.blocks[block]).points.findIndex((p) => apart(p, [x, 0, z]) <= REACH);
}

/**
 * Block `block`'s line from `from` to `to` seen from above, either way round; -1 for none.
 * @param {Scene} scene
 * @param {number} block
 * @param {Flat} from
 * @param {Flat} to
 * @returns {number}
 */
function lineAt(scene, block, from, to) {
  const [a, b] = [pointAt(scene, block, from), pointAt(scene, block, to)];

  return linesOf(scene.blocks[block]).lines.findIndex(
    ([p, q]) => (p === a && q === b) || (p === b && q === a),
  );
}

/**
 * The clicks along `path`, each line drawn from where the last one ended.
 * @param {readonly Flat[]} path
 * @param {number} block
 * @returns {Edit[]}
 */
function clicked(path, block) {
  const [x = 0, z = 0] = path[0] ?? [];

  return path.slice(1).map((to, k) => (scene, last) => {
    /** @type {End} */
    const from = k === 0 || "refused" in last ? { x, z } : { block, point: last.to };

    return addLine(scene, from, { x: to[0], z: to[1] }, REACH);
  });
}

/**
 * The edits a person makes for `plan` on block `block`, in order: each path clicked, then its
 * lines marked, its heights set, its eaves and ridges pulled up.
 * @param {Plan} plan
 * @param {number} block
 * @param {RoofSize} size
 * @returns {Edit[]}
 */
function edits(plan, block, size) {
  /** @type {Edit[]} */
  const marks = (plan.marks ?? []).map(
    ({ from, to, kind }) =>
      (scene) =>
        markLine(scene, block, lineAt(scene, block, from, to), kind),
  );

  /** @type {Edit[]} */
  const heights = (plan.heights ?? []).map(
    ({ at, height }) =>
      (scene) =>
        setHeight(scene, block, pointAt(scene, block, at), height),
  );

  return [
    ...plan.paths.flatMap((path) => clicked(path, block)),
    ...marks,
    ...heights,
    (scene) => pullEaves(scene, block, size.eave),
    (scene) => pullRidges(scene, block, size.ridge),
  ];
}

/**
 * `plan` moved by `at`.
 * @param {Plan} plan
 * @param {{ readonly x: number, readonly z: number }} at
 * @returns {Plan}
 */
function moved(plan, at) {
  /** @param {Flat} p @returns {Flat} */
  const by = ([x, z]) => [at.x + x, at.z + z];

  return {
    paths: plan.paths.map((path) => path.map((p) => by(p))),
    marks: (plan.marks ?? []).map(({ from, to, kind }) => ({ from: by(from), to: by(to), kind })),
    heights: (plan.heights ?? []).map(({ at: p, height }) => ({ at: by(p), height })),
  };
}

/**
 * @param {Scene} scene
 * @param {string} id
 * @param {{ readonly x: number, readonly z: number }} at
 * @param {RoofSize} size
 * @returns {Edited}
 */
export function placeRoof(scene, id, at, size) {
  const roof = ROOFS.find((r) => r.id === id);

  if (roof === undefined) return { refused: "missing" };

  if (!(size.width > 0 && size.depth > 0)) return { refused: "short" };

  const block = scene.blocks.length;

  /** @type {Edited} */
  let last = { scene, faces: [], block, from: -1, to: -1 };

  for (const edit of edits(moved(roof.plan(size), at), block, size)) {
    if ("refused" in last) return last;

    const next = edit(last.scene, last);

    // Each line is the new block's: one ending on another traced roof would join it.
    last = "refused" in next || next.block === block ? next : { refused: "joins" };
  }

  return "refused" in last ? last : { ...last, faces: [], from: -1, to: -1 };
}
