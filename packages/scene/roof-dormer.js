// Dormers (ADR 20): a closed loop traced inside a face stands on it. Which faces stand on which,
// seen from above. Pure.

import { area, onSegment } from "./roof-plan.js";

/**
 * Whether `p` lies on an edge of the polygon of `corners` seen from above.
 * @param {readonly (readonly number[])[]} corners
 * @param {readonly number[]} p
 * @returns {boolean}
 */
const edged = (corners, p) =>
  corners.some((a, k) => onSegment(p, a, corners[(k + 1) % corners.length] ?? a));

/**
 * Whether `p` lies inside the polygon of `corners` seen from above, clear of its edges.
 * @param {readonly (readonly number[])[]} corners
 * @param {readonly number[]} p
 * @returns {boolean}
 */
export function within(corners, p) {
  const [x = 0, , z = 0] = p;
  let crossings = 0;

  for (const [k, a] of corners.entries()) {
    const b = corners[(k + 1) % corners.length] ?? a;

    if (onSegment(p, a, b)) return false;

    const [ax = 0, , az = 0] = a;
    const [bx = 0, , bz = 0] = b;

    if (az > z !== bz > z && x < ax + ((bx - ax) * (z - az)) / (bz - az)) crossings += 1;
  }

  return crossings % 2 === 1;
}

/**
 * Whether the plan `plan` lies inside the plan `around`, one corner clear of its edges.
 * @param {readonly (readonly number[])[]} plan
 * @param {readonly (readonly number[])[]} around
 * @returns {boolean}
 */
const inside = (plan, around) =>
  plan.some((p) => within(around, p)) && plan.every((p) => within(around, p) || edged(around, p));

/**
 * For each face, the face it lies inside seen from above, the one a dormer stands on: the
 * smallest larger face holding it; -1 for none.
 * @param {readonly (readonly number[])[]} points
 * @param {readonly (readonly number[])[]} faces
 * @returns {number[]}
 */
function hosts(points, faces) {
  /** @type {readonly (readonly (readonly number[])[])[]} */
  const plans = faces.map((face) => face.map((p) => points[p] ?? []));
  const size = faces.map((face) => Math.abs(area(points, face)));

  return plans.map((plan, g) => {
    const around = [...plans.keys()].filter(
      (f) => (size[f] ?? 0) > (size[g] ?? 0) && inside(plan, plans[f] ?? []),
    );

    return around.reduce(
      (host, f) => (host < 0 || (size[f] ?? 0) < (size[host] ?? 0) ? f : host),
      -1,
    );
  });
}

/**
 * The faces that stand on no other: those the house's outline is made of.
 * @param {readonly (readonly number[])[]} points
 * @param {readonly (readonly number[])[]} faces
 * @returns {(readonly number[])[]}
 */
export function standing(points, faces) {
  const on = hosts(points, faces);

  return faces.filter((_, f) => on[f] === -1);
}
