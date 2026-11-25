// Editing a traced roof's points (ADR 20 "Points"): one dragged, one put into a line, one taken
// out. Each changes the block's lines, which `rebuild` makes faces of again. Pure.

import { rebuild } from "./roof-faces.js";
import { touching } from "./roof-plan.js";
import { compacted } from "./roof-run.js";
import { linesOf } from "./roof-snap.js";

/** @import { Scene } from "./schema.d.ts" */
/** @import { Edited, Place } from "./roof.d.ts" */
/** @import { Lines } from "./roof-faces.js" */

/** Metres a point put into a line keeps off its ends. */
const OFF_END = 0.05;

/**
 * Whether two of `lines`' lines cross or overlap.
 * @param {Lines} lines
 * @returns {boolean}
 */
const tangled = (lines) =>
  lines.lines.some((l, i) => lines.lines.slice(i + 1).some((m) => touching(lines.points, l, m)));

/**
 * Block `block`'s point `point` moved level to `to`; refused where lines would cross.
 * @param {Scene} scene
 * @param {number} block
 * @param {number} point
 * @param {Place} to
 * @returns {Edited}
 */
export function movePoint(scene, block, point, to) {
  const lines = linesOf(scene.blocks[block]);
  const at = lines.points[point];

  if (at === undefined) return { refused: "missing" };

  const points = lines.points.map((p, i) => (i === point ? [to.x, p[1] ?? 0, to.z] : p));
  const moved = { ...lines, points };

  if (tangled(moved)) return { refused: "crosses" };

  return { ...rebuild(scene, block, moved), block, from: point, to: point };
}

/**
 * The spot on the line `from`–`to` nearest `at` seen from above, kept `OFF_END` off its ends, at
 * the height between them; none on a line too short for that.
 * @param {readonly number[]} from
 * @param {readonly number[]} to
 * @param {Place} at
 * @returns {number[] | null}
 */
function between([ax = 0, ay = 0, az = 0], [bx = 0, by = 0, bz = 0], at) {
  const [dx, dy, dz] = [bx - ax, by - ay, bz - az];
  const length = Math.hypot(dx, dz);

  if (length <= 2 * OFF_END) return null;

  const along = ((at.x - ax) * dx + (at.z - az) * dz) / (length * length);
  const t = Math.min(1 - OFF_END / length, Math.max(OFF_END / length, along));

  return [ax + dx * t, ay + dy * t, az + dz * t];
}

/**
 * Block `block`'s line `line` split by a new point where `at` lies nearest along it, at the height
 * between its ends; an eave or a ridge both its ends are.
 * @param {Scene} scene
 * @param {number} block
 * @param {number} line
 * @param {Place} at
 * @returns {Edited}
 */
export function splitLine(scene, block, line, at) {
  const lines = linesOf(scene.blocks[block]);
  const [a = -1, b = -1] = lines.lines[line] ?? [];
  const [from, to] = [lines.points[a], lines.points[b]];

  if (!from || !to) return { refused: "missing" };

  const spot = between(from, to, at);

  if (spot === null) return { refused: "short" };

  const p = lines.points.length;
  /** @param {readonly number[]} list */
  const both = (list) => list.includes(a) && list.includes(b);

  const split = {
    ...lines,
    points: [...lines.points, spot],
    lines: [...lines.lines.map((l, i) => (i === line ? [a, p] : l)), [p, b]],
    eaves: both(lines.eaves) ? [...lines.eaves, p] : lines.eaves,
    ridges: both(lines.ridges) ? [...lines.ridges, p] : lines.ridges,
  };

  return { ...rebuild(scene, block, split), block, from: p, to: p };
}

/**
 * Block `block` without point `point`: the two lines meeting there joined into one; a point more
 * or fewer lines meet at takes them with it. Refused where the joined line would cross another.
 * @param {Scene} scene
 * @param {number} block
 * @param {number} point
 * @returns {Edited}
 */
export function removePoint(scene, block, point) {
  const lines = linesOf(scene.blocks[block]);

  if (lines.points[point] === undefined) return { refused: "missing" };

  const others = lines.lines.flatMap(([a, b]) => (a === point ? [b] : b === point ? [a] : []));
  const left = lines.lines.filter((l) => !l.includes(point));
  const [c, d] = others;

  const joined =
    others.length === 2 &&
    c !== undefined &&
    d !== undefined &&
    !left.some((l) => l.includes(c) && l.includes(d))
      ? [...left, [c, d]]
      : left;

  if (joined.length === 0) return { refused: "missing" };

  const kept = compacted(lines, joined);

  if (tangled(kept)) return { refused: "crosses" };

  return { ...rebuild(scene, block, kept), block, from: -1, to: -1 };
}
