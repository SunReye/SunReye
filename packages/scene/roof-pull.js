// Pulling a traced roof up (ADR 20): the eaves to their height, then the ridges to theirs; a line
// made an eave or a ridge; a point's height set. Each an edit of a block's lines handed to
// `rebuild`, which lets every other point follow. Pure.

import { rebuild } from "./roof-faces.js";
import { flat, kinds } from "./roof-heights.js";
import { linesOf } from "./roof-snap.js";

/** @import { Scene } from "./schema.d.ts" */
/** @import { Edited, Kind } from "./roof.d.ts" */

/**
 * Block `block`'s points of kind `kind` but those whose height was set, raised to `height`.
 * @param {Scene} scene
 * @param {number} block
 * @param {Kind} kind
 * @param {number} height
 * @returns {Edited}
 */
function pull(scene, block, kind, height) {
  const lines = linesOf(scene.blocks[block]);

  if (lines.lines.length === 0) return { refused: "missing" };

  const of = kinds(lines);

  const points = lines.points.map((p, i) =>
    of[i] === kind && !lines.set.includes(i) ? [p[0] ?? 0, height, p[2] ?? 0] : p,
  );

  return { ...rebuild(scene, block, { ...lines, points }), block, from: -1, to: -1 };
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} height
 * @returns {Edited}
 */
export function pullEaves(scene, block, height) {
  return pull(scene, block, "eave", height);
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} height
 * @returns {Edited}
 */
export function pullRidges(scene, block, height) {
  return pull(scene, block, "ridge", height);
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} line
 * @param {Kind} kind
 * @returns {Edited}
 */
export function markLine(scene, block, line, kind) {
  const lines = linesOf(scene.blocks[block]);
  const [a, b] = lines.lines[line] ?? [];

  if (a === undefined || b === undefined) return { refused: "missing" };

  /** @param {readonly number[]} list @param {boolean} on */
  const marked = (list, on) => [...list.filter((p) => p !== a && p !== b), ...(on ? [a, b] : [])];

  const next = {
    ...lines,
    eaves: marked(lines.eaves, kind === "eave"),
    ridges: marked(lines.ridges, kind === "ridge"),
  };

  return { ...rebuild(scene, block, next), block, from: a, to: b };
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} point
 * @param {number} height
 * @returns {Edited}
 */
export function setHeight(scene, block, point, height) {
  const lines = linesOf(scene.blocks[block]);
  const at = lines.points[point];

  if (at === undefined || !Number.isFinite(height)) return { refused: "missing" };

  const points = lines.points.map((p, i) => (i === point ? [p[0] ?? 0, height, p[2] ?? 0] : p));
  const set = lines.set.includes(point) ? lines.set : [...lines.set, point];

  return { ...rebuild(scene, block, { ...lines, points, set }), block, from: point, to: point };
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} line
 * @returns {Kind | undefined}
 */
export function lineKind(scene, block, line) {
  const lines = linesOf(scene.blocks[block]);
  const [a = -1, b = -1] = lines.lines[line] ?? [];
  const kind = kinds(lines);

  return kind[a] !== undefined && kind[a] === kind[b] ? kind[a] : undefined;
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @returns {number[]}
 */
export function bent(scene, block) {
  const faces = scene.blocks[block]?.freeForm?.faces ?? [];

  return scene.blocks[block]?.freeForm?.traced === undefined
    ? []
    : [...faces.keys()].filter((f) => !flat(faces[f] ?? []));
}
