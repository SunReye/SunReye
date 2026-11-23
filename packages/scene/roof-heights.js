// A traced roof's heights (ADR 20): which points are eaves and which ridges, the points that follow
// them so faces stay flat, and whether a face is flat. Pure.

import { raisedOn, standing } from "./roof-nest.js";
import { rim } from "./roof-outline.js";
import { PLACE } from "./roof-plan.js";

/** @import { Lines } from "./roof-faces.js" */
/** @import { Kind } from "./roof.d.ts" */

/** Metres a corner may lie off its face's plane: the pv crate's flatness. */
const FLATNESS = 0.02;

/**
 * A line's key, the same whichever way it runs.
 * @param {number} a
 * @param {number} b
 * @returns {string}
 */
const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/**
 * Whether the outline turns at `p`, between `before` and `after`, seen from above.
 * @param {readonly number[]} before
 * @param {readonly number[]} p
 * @param {readonly number[]} after
 * @returns {boolean}
 */
function turns(before, p, after) {
  const [ax = 0, , az = 0] = before;
  const [px = 0, , pz = 0] = p;
  const [bx = 0, , bz = 0] = after;
  const cross = (px - ax) * (bz - pz) - (pz - az) * (bx - px);

  return Math.abs(cross) > PLACE * (Math.hypot(px - ax, pz - az) + Math.hypot(bx - px, bz - pz));
}

/**
 * Each point's kind: the person's word first; else a corner of the outline is an eave, a point an
 * inner line ends at a ridge, unless the line only runs straight on through it, and any other point
 * on the outline an eave. Undefined: it follows.
 * @param {Lines} lines
 * @returns {(Kind | undefined)[]}
 */
export function kinds(lines) {
  const loop = rim(standing(lines.points, lines.faces));
  const edges = new Set(loop.map((p, k) => key(p, loop[(k + 1) % loop.length] ?? p)));

  const corners = new Set(
    loop.filter((p, k) =>
      turns(
        lines.points[loop[(k + loop.length - 1) % loop.length] ?? p] ?? [],
        lines.points[p] ?? [],
        lines.points[loop[(k + 1) % loop.length] ?? p] ?? [],
      ),
    ),
  );

  const raised = new Set([...raisedOn(lines.points, lines.faces).values()].flat());

  const inner = new Set(
    lines.lines
      .filter(([a = 0, b = 0]) => !edges.has(key(a, b)) && !raised.has(a) && !raised.has(b))
      .flatMap(([a = 0, b = 0]) => [a, b]),
  );

  return lines.points.map((_, p) => {
    if (lines.ridges.includes(p)) return "ridge";

    if (lines.eaves.includes(p) || corners.has(p)) return "eave";

    if (inner.has(p) && !straight(lines, p)) return "ridge";

    return loop.includes(p) ? "eave" : undefined;
  });
}

/**
 * Whether point `p` only joins two lines running straight on through it, seen from above: a point
 * clicked partway along one line.
 * @param {Lines} lines
 * @param {number} p
 * @returns {boolean}
 */
function straight(lines, p) {
  const ends = lines.lines.flatMap(([a, b]) => (a === p ? [b] : b === p ? [a] : []));
  const [before = -1, after = -1] = ends;

  return (
    ends.length === 2 &&
    !turns(lines.points[before] ?? [], lines.points[p] ?? [], lines.points[after] ?? [])
  );
}

/**
 * A 3 × 3 matrix's determinant, row by row.
 * @param {readonly number[]} m
 * @returns {number}
 */
const det = ([a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0]) =>
  a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

/**
 * The plane `y = a·x + b·z + c` fitting `spots` best; null where they lie in one line seen
 * from above.
 * @param {readonly (readonly number[])[]} spots
 * @returns {((x: number, z: number) => number) | null}
 */
export function plane(spots) {
  // The normal equations of least squares, in x, z and 1.
  let [xx, xz, x1, zz, z1, n, xy, zy, y1] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  for (const [x = 0, y = 0, z = 0] of spots) {
    xx += x * x;
    xz += x * z;
    x1 += x;
    zz += z * z;
    z1 += z;
    n += 1;
    xy += x * y;
    zy += z * y;
    y1 += y;
  }

  const m = det([xx, xz, x1, xz, zz, z1, x1, z1, n]);
  const scale = (xx + zz + n) ** 3;

  if (n < 3 || Math.abs(m) <= 1e-12 * scale) return null;

  const a = det([xy, xz, x1, zy, zz, z1, y1, z1, n]) / m;
  const b = det([xx, xy, x1, xz, zy, z1, x1, y1, n]) / m;
  const c = det([xx, xz, xy, xz, zz, zy, x1, z1, y1]) / m;

  return (x, z) => a * x + b * z + c;
}

/**
 * The points of `face`, and `also`, not yet known, each with its spot on the plane the face's known
 * points fix; none where they fix none.
 * @param {readonly number[]} face
 * @param {readonly number[]} also
 * @param {readonly (readonly number[])[]} points
 * @param {readonly boolean[]} known
 * @returns {[number, number[]][]}
 */
function levelled(face, also, points, known) {
  const free = [...face, ...also].filter((p) => known[p] !== true);
  const fixed = face.filter((p) => known[p] === true).map((p) => points[p] ?? []);
  const on = free.length > 0 ? plane(fixed) : null;

  if (on === null) return [];

  return free.map((p) => {
    const [x = 0, , z = 0] = points[p] ?? [];

    return [p, [x, on(x, z), z]];
  });
}

/**
 * `lines` with every point that is no eave, ridge or set point at its height on a face whose eave,
 * ridge and set points fix a plane, again until no point changes. A point none reaches keeps its.
 * @param {Lines} lines
 * @param {readonly (readonly number[])[]} faces
 * @returns {Lines}
 */
export function follow(lines, faces) {
  const kind = kinds({ ...lines, faces });
  const points = lines.points.map((p) => [...p]);

  const known = lines.points.map((_, p) => kind[p] !== undefined || lines.set.includes(p));
  const on = raisedOn(lines.points, faces);
  // A dormer's points lie on the face it stands on before its own faces level them.
  const order = [...faces.keys()].toSorted((f, g) => Number(!on.has(f)) - Number(!on.has(g)));

  // A face that levels its points may give the next face its third.
  for (let found = levelledAll(); found.length > 0; found = levelledAll())
    for (const [p, at] of found)
      if (known[p] !== true) {
        points[p] = at;
        known[p] = true;
      }

  return { ...lines, points };

  function levelledAll() {
    return order.flatMap((f) => levelled(faces[f] ?? [], on.get(f) ?? [], points, known));
  }
}

/**
 * A loop's Newell normal and the mean of its corners.
 * @param {readonly (readonly number[])[]} corners
 * @returns {{ readonly normal: number[], readonly mean: number[] }}
 */
function newell(corners) {
  const normal = [0, 0, 0];
  const mean = [0, 0, 0];
  const share = 1 / corners.length;

  for (const [k, [ax = 0, ay = 0, az = 0]] of corners.entries()) {
    const [bx = 0, by = 0, bz = 0] = corners[(k + 1) % corners.length] ?? [];
    const terms = [(ay - by) * (az + bz), (az - bz) * (ax + bx), (ax - bx) * (ay + by)];

    for (const i of [0, 1, 2]) {
      normal[i] = (normal[i] ?? 0) + (terms[i] ?? 0);
      mean[i] = (mean[i] ?? 0) + ([ax, ay, az][i] ?? 0) * share;
    }
  }

  return { normal, mean };
}

/**
 * Whether no corner lies more than 2 cm off the plane through the corners' mean square to their
 * Newell normal, as the pv crate measures it.
 * @param {readonly (readonly number[])[]} corners
 * @returns {boolean}
 */
export function flat(corners) {
  const { normal, mean } = newell(corners);
  const length = Math.hypot(...normal);

  /** @param {readonly number[]} p */
  const off = (p) =>
    Math.abs(
      [0, 1, 2].reduce((sum, i) => sum + ((p[i] ?? 0) - (mean[i] ?? 0)) * (normal[i] ?? 0), 0),
    ) / length;

  return corners.length >= 3 && length > 1e-9 && corners.every((p) => off(p) <= FLATNESS);
}
