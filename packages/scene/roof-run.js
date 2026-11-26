// A traced block's lines as edits change them (ADR 20 "Points"): the straight run a line lies in, a
// side split by a point clicked on it, or where another line or roof meets it, still one side to the
// person who drags it; and lines kept without the points none of them uses. Pure.

/** @import { Lines } from "./roof-faces.js" */

/**
 * The lines' points meeting `p`'s, but `except`.
 * @param {Lines} lines
 * @param {number} p
 * @returns {number[]}
 */
const neighbours = (lines, p) =>
  lines.lines.flatMap(([a, b]) => (a === p ? [b ?? -1] : b === p ? [a ?? -1] : []));

/** The sine of the largest turn two lines make and still run straight on to a person: a building
 * model's corners lie a few centimetres off. */
const STRAIGHT = Math.sin((3 * Math.PI) / 180);

/**
 * Whether line `at`–`p` runs straight on from line `from`–`at`, seen from above.
 * @param {Lines} lines
 * @param {number} from
 * @param {number} at
 * @param {number} p
 * @returns {boolean}
 */
function straightOn(lines, from, at, p) {
  const [fx = 0, , fz = 0] = lines.points[from] ?? [];
  const [ax = 0, , az = 0] = lines.points[at] ?? [];
  const [px = 0, , pz = 0] = lines.points[p] ?? [];
  const [ux, uz, vx, vz] = [ax - fx, az - fz, px - ax, pz - az];
  const lengths = Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1;

  return ux * vx + uz * vz > 0 && Math.abs(ux * vz - uz * vx) / lengths < STRAIGHT;
}

/**
 * The one point not yet in `run` that a line from `at` runs straight on to from `from`; undefined
 * for none or more than one.
 * @param {Lines} lines
 * @param {readonly number[]} run
 * @param {number} from
 * @param {number} at
 * @returns {number | undefined}
 */
function onward(lines, [...run], from, at) {
  const ahead = neighbours(lines, at).filter(
    (p) => !run.includes(p) && straightOn(lines, from, at, p),
  );

  return ahead.length === 1 ? ahead[0] : undefined;
}

/**
 * The points of the straight run line `a`–`b` lies in: on from each end through every point one
 * line runs straight on from, within a few degrees, whatever other lines meet there.
 * @param {Lines} lines
 * @param {number} a
 * @param {number} b
 * @returns {Set<number>}
 */
export function straightRun(lines, a, b) {
  const run = new Set([a, b]);

  for (const [start, before] of [
    [a, b],
    [b, a],
  ]) {
    let [at, from] = [start, before];

    for (let next = onward(lines, [...run], from, at); next !== undefined;) {
      run.add(next);
      [from, at] = [at, next];
      next = onward(lines, [...run], from, at);
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
