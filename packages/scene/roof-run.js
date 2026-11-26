// A traced block's lines as edits change them (ADR 20 "Points"): the straight run a line lies in, a
// side split by a point clicked on it, or where another line or roof meets it, still one side to the
// person who drags it; and lines kept without the points none of them uses. Pure.

import { PLACE } from "./roof-plan.js";

/** @import { Lines } from "./roof-faces.js" */

/**
 * The lines' points meeting `p`'s, but `except`.
 * @param {Lines} lines
 * @param {number} p
 * @returns {number[]}
 */
const neighbours = (lines, p) =>
  lines.lines.flatMap(([a, b]) => (a === p ? [b ?? -1] : b === p ? [a ?? -1] : []));

/**
 * Whether `p` lies on the straight line through `a` and `b`, seen from above.
 * @param {Lines} lines
 * @param {number} a
 * @param {number} b
 * @param {number} p
 * @returns {boolean}
 */
function onLine(lines, a, b, p) {
  const [ax = 0, , az = 0] = lines.points[a] ?? [];
  const [bx = 0, , bz = 0] = lines.points[b] ?? [];
  const [px = 0, , pz = 0] = lines.points[p] ?? [];
  const length = Math.hypot(bx - ax, bz - az) || 1;

  return Math.abs((bx - ax) * (pz - az) - (bz - az) * (px - ax)) / length < PLACE;
}

/**
 * The points of the straight run line `a`–`b` lies in: on from each end through every point one
 * line keeps it straight from, whatever other lines meet there.
 * @param {Lines} lines
 * @param {number} a
 * @param {number} b
 * @returns {Set<number>}
 */
export function straightRun(lines, a, b) {
  const run = new Set([a, b]);

  for (const start of [a, b]) {
    let at = start;

    for (;;) {
      const ahead = neighbours(lines, at).filter((p) => !run.has(p) && onLine(lines, a, b, p));

      if (ahead.length !== 1) break;

      const [next = -1] = ahead;

      run.add(next);
      at = next;
    }
  }

  return run;
}

/**
 * `lines` kept to `left`, without the points no line of `left` uses, the others numbered anew.
 * @param {Lines} lines
 * @param {readonly (readonly number[])[]} left
 * @returns {Lines}
 */
export function compacted(lines, left) {
  const used = [...lines.points.keys()].filter((p) => left.some((l) => l.includes(p)));
  const renamed = new Map(used.map((p, i) => [p, i]));

  /** @param {number} p */
  const rename = (p) => {
    const now = renamed.get(p);

    return now === undefined ? [] : [now];
  };

  return {
    points: used.map((p) => lines.points[p] ?? []),
    set: lines.set.flatMap((p) => rename(p)),
    lines: left.map((l) => l.flatMap((p) => rename(p))),
    faces: lines.faces.map((f) => f.flatMap((p) => rename(p))),
    eaves: lines.eaves.flatMap((p) => rename(p)),
    ridges: lines.ridges.flatMap((p) => rename(p)),
  };
}
