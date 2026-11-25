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
export function pointAt(scene, block, [x, z]) {
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
export function lineAt(scene, block, from, to) {
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
export function clicked(path, block) {
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
 * `plan` turned `turn` degrees clockwise seen from above about its corner, then moved by `at`.
 * @param {Plan} plan
 * @param {{ readonly x: number, readonly z: number }} at
 * @param {number} turn
 * @returns {Plan}
 */
function moved(plan, at, turn) {
  const [sin, cos] = [Math.sin((turn * Math.PI) / 180), Math.cos((turn * Math.PI) / 180)];

  /** @param {Flat} p @returns {Flat} */
  const by = ([x, z]) => [at.x + x * cos - z * sin, at.z + x * sin + z * cos];

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
 * @param {number} [turn]
 * @returns {Edited}
 */
export function placeRoof(scene, id, at, size, turn = 0) {
  const roof = ROOFS.find((r) => r.id === id);

  if (roof === undefined) return { refused: "missing" };

  if (!(size.width > 0 && size.depth > 0)) return { refused: "short" };

  const block = scene.blocks.length;

  /** @type {Edited} */
  let last = { scene, faces: [], block, from: -1, to: -1 };

  for (const edit of edits(moved(roof.plan(size), at, turn), block, size)) {
    if ("refused" in last) return last;

    const next = edit(last.scene, last);

    // Each line is the new block's: one ending on another traced roof would join it.
    last = "refused" in next || next.block === block ? next : { refused: "joins" };
  }

  return "refused" in last ? last : { ...last, faces: [], from: -1, to: -1 };
}

/**
 * Whether `b` turns left of the line from `o` to `a`, by how much.
 * @param {Flat} o
 * @param {Flat} a
 * @param {Flat} b
 */
const cross = ([ox, oz], [ax, az], [bx, bz]) => (ax - ox) * (bz - oz) - (az - oz) * (bx - ox);

/**
 * One half of a hull: the points in order, each turning left of the two before it.
 * @param {readonly Flat[]} list
 * @returns {Flat[]}
 */
function halfHull(list) {
  /** @type {Flat[]} */
  const kept = [];

  for (const p of list) {
    while (kept.length >= 2 && cross(kept.at(-2) ?? p, kept.at(-1) ?? p, p) <= 0) kept.pop();

    kept.push(p);
  }

  return kept.slice(0, -1);
}

/**
 * The points' convex hull, counter-clockwise in x and z.
 * @param {readonly Flat[]} points
 * @returns {Flat[]}
 */
function hull(points) {
  const sorted = points.toSorted(([ax, az], [bx, bz]) => ax - bx || az - bz);

  return [...halfHull(sorted), ...halfHull(sorted.toReversed())];
}

/**
 * @typedef {{
 *   readonly at: { readonly x: number, readonly z: number },
 *   readonly turn: number,
 *   readonly width: number,
 *   readonly depth: number,
 * }} Rectangle
 */

/**
 * The rectangle around `points` whose width runs `turn` degrees clockwise from x.
 * @param {readonly Flat[]} points
 * @param {number} turn
 * @returns {Rectangle}
 */
function around(points, turn) {
  const [sin, cos] = [Math.sin((turn * Math.PI) / 180), Math.cos((turn * Math.PI) / 180)];
  const us = points.map(([x, z]) => x * cos + z * sin);
  const vs = points.map(([x, z]) => -x * sin + z * cos);
  const [u, v] = [Math.min(...us), Math.min(...vs)];

  return {
    at: { x: u * cos - v * sin, z: u * sin + v * cos },
    turn,
    width: Math.max(...us) - u,
    depth: Math.max(...vs) - v,
  };
}

/**
 * @param {Rectangle} best
 * @param {Rectangle} next
 * @returns {Rectangle}
 */
const smaller = (best, next) => (next.width * next.depth < best.width * best.depth ? next : best);

/**
 * The smallest rectangle around `points` seen from above, as `placeRoof` takes it: its corner,
 * the degrees its width is turned clockwise from x, and its width and depth; null for points
 * that bound no area.
 * @param {readonly Flat[]} points
 * @returns {Rectangle | null}
 */
export function rectangleAround(points) {
  const sides = hull(points);

  if (sides.length < 3) return null;

  return sides
    .map(([px, pz], index) => {
      const [qx, qz] = sides[(index + 1) % sides.length] ?? [px, pz];

      return around(points, (Math.atan2(qz - pz, qx - px) * 180) / Math.PI);
    })
    .reduce((best, next) => smaller(best, next));
}
