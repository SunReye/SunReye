// A traced block's faces derived again from its lines (ADR 20), and what stands on them kept on the
// face that stays. Pure.

import { flat, follow } from "./roof-heights.js";
import { standing } from "./roof-dormer.js";
import { outline } from "./roof-outline.js";
import { area, loops } from "./roof-plan.js";

/** @import { Block, Scene } from "./schema.d.ts" */
/**
 * A traced block's points, the points whose height was set, its lines, its faces' points, and the
 * points the person made eaves and ridges.
 * @typedef {{
 *   readonly points: readonly (readonly number[])[],
 *   readonly set: readonly number[],
 *   readonly lines: readonly (readonly number[])[],
 *   readonly faces: readonly (readonly number[])[],
 *   readonly eaves: readonly number[],
 *   readonly ridges: readonly number[],
 * }} Lines
 */

/**
 * `list` with each item passed through `change`; those it answers undefined for dropped.
 * @template {{ readonly block: number }} T
 * @param {readonly T[] | undefined} list
 * @param {(item: T) => T | undefined} change
 * @returns {T[]}
 */
function kept(list, change) {
  return (list ?? []).flatMap((item) => change(item) ?? []);
}

/**
 * `scene` with what stands on a roof face passed through `change`.
 * @param {Scene} scene
 * @param {<T extends { readonly block: number, readonly face: number }>(item: T) => T | undefined} change
 * @returns {Scene}
 */
function onFaces(scene, change) {
  return {
    ...scene,
    grids: kept(scene.grids, change),
    chimneys: kept(scene.chimneys, change),
    roofWindows: kept(scene.roofWindows, change),
    faceDetails: kept(scene.faceDetails, change),
    existingPv: kept(scene.existingPv, change),
  };
}

/**
 * `scene` without block `index`; what named a later block moves up.
 * @param {Scene} scene
 * @param {number} index
 * @returns {Scene}
 */
export function withoutBlock(scene, index) {
  /** @type {<T extends { readonly block: number }>(item: T) => T | undefined} */
  const change = (item) => {
    const block = item.block > index ? item.block - 1 : item.block;

    return item.block === index ? undefined : { ...item, block };
  };

  return {
    ...onFaces(scene, change),
    blocks: scene.blocks.filter((_, i) => i !== index),
    equipment: kept(scene.equipment, change),
    openings: kept(scene.openings, change),
  };
}

/** A new traced block: its rectangle goes unused. */
/** @type {Block} */
const FRESH = {
  x: 0,
  z: 0,
  width: 0,
  depth: 0,
  eave: 0,
  rotation: 0,
  roof: { kind: "flat" },
};

/**
 * How many points two loops share.
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @returns {number}
 */
const shared = (a, b) => a.filter((p) => b.includes(p)).length;

/**
 * The loop of `found` not yet taken in `stays` that stays face `old`: of those keeping three or
 * more of its points, the one keeping most, then the larger; -1 for none.
 * @param {Lines} lines
 * @param {readonly number[]} old
 * @param {readonly (readonly number[])[]} found
 * @param {readonly number[]} stays
 * @returns {number}
 */
function heir(lines, old, found, stays) {
  /** @param {readonly number[]} loop */
  const rank = (loop) => shared(old, loop) * 1e9 + Math.abs(area(lines.points, loop));
  let best = -1;

  for (const [k, loop] of found.entries()) {
    const free = stays[k] === -1 && shared(old, loop) >= 3;

    if (free && (best === -1 || rank(loop) > rank(found[best] ?? []))) best = k;
  }

  return best;
}

/**
 * For each loop found, the old face it stays, or -1.
 * @param {Lines} lines
 * @param {readonly (readonly number[])[]} found
 * @returns {number[]}
 */
function matched(lines, found) {
  const stays = found.map(() => -1);

  for (const [face, old] of lines.faces.entries()) {
    const best = heir(lines, old, found, stays);

    if (best >= 0) stays[best] = face;
  }

  return stays;
}

/**
 * The loops' places: a loop that stays an old face takes its place; a new loop takes a place an
 * old face left, the first first, else one after the others; places still empty close up. For each
 * place, the loop in it.
 * @param {readonly number[]} stays
 * @param {number} old
 * @returns {number[]}
 */
function places(stays, old) {
  /** @type {number[]} */
  const slots = Array.from({ length: old }, () => -1);

  for (const [k, was] of stays.entries()) if (was >= 0) slots[was] = k;

  for (const [k, was] of stays.entries())
    if (was < 0) {
      const free = slots.indexOf(-1);

      if (free >= 0) slots[free] = k;
      else slots.push(k);
    }

  return slots.filter((k) => k >= 0);
}

/**
 * A list of points in order; undefined when empty, so it is left out.
 * @param {readonly number[]} list
 */
const sorted = (list) => (list.length > 0 ? list.toSorted((a, b) => a - b) : undefined);

/**
 * The traced part stored for `lines` whose faces are `faces`: a list of points left out when empty.
 * @param {Lines} lines
 * @param {readonly (readonly number[])[]} faces
 */
function stored(lines, faces) {
  const [set, eaves, ridges] = [sorted(lines.set), sorted(lines.eaves), sorted(lines.ridges)];

  return {
    points: lines.points,
    lines: lines.lines,
    faces,
    ...(set && { set }),
    ...(eaves && { eaves }),
    ...(ridges && { ridges }),
  };
}

/**
 * Block `index` of `scene` traced as `lines`, its faces derived again from their loops, its points
 * that follow at their heights, and for each old face its place now, or -1 where it went, taking
 * what stood on it; a bent face's module grids go. `lines.faces` are the old faces, by `lines`'
 * points.
 * @param {Scene} scene
 * @param {number} index
 * @param {Lines} lines
 * @returns {{ readonly scene: Scene, readonly faces: readonly number[] }}
 */
export function rebuild(scene, index, lines) {
  const found = loops(lines.points, lines.lines);
  const stays = matched(lines, found);
  const order = places(stays, lines.faces.length);
  const moved = lines.faces.map((_, face) => order.indexOf(stays.indexOf(face)));

  /** @type {readonly (readonly number[])[]} */
  const faces = order.map((k) => found[k] ?? []);
  const followed = follow(lines, faces);
  const corners = faces.map((loop) => loop.map((p) => followed.points[p] ?? []));

  const freeForm = {
    footprint: outline(followed.points, standing(followed.points, faces)),
    faces: corners,
    traced: stored(followed, faces),
  };

  /** @type {<T extends { readonly block: number, readonly face: number }>(item: T) => T | undefined} */
  const change = (item) => {
    const face = moved[item.face] ?? -1;

    if (item.block !== index) return item;

    return face < 0 ? undefined : { ...item, face };
  };

  const block = scene.blocks[index] ?? FRESH;

  const placed = onFaces(scene, change);

  const next = {
    ...placed,
    grids: placed.grids?.filter((g) => g.block !== index || flat(corners[g.face] ?? [])),
    blocks: [
      ...scene.blocks.slice(0, index),
      { ...block, freeForm },
      ...scene.blocks.slice(index + 1),
    ],
  };

  return { scene: next, faces: moved };
}
