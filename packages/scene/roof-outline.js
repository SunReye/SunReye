// A traced roof's outline seen from above (ADR 20): the edges its faces use once. Pure.

/**
 * A line's key, the same whichever way it runs.
 * @param {number} a
 * @param {number} b
 * @returns {string}
 */
const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/**
 * The outline of `faces` seen from above, as its points in order; none unless they make one loop.
 * @param {readonly (readonly number[])[]} faces
 * @returns {number[]}
 */
export function rim(faces) {
  /** @type {readonly (readonly number[])[]} */
  const edges = faces.flatMap((face) => face.map((p, k) => [p, face[(k + 1) % face.length] ?? p]));
  /** @type {Map<string, number>} */
  const used = new Map();

  for (const [a = 0, b = 0] of edges) used.set(key(a, b), (used.get(key(a, b)) ?? 0) + 1);

  const edge = edges.filter(([a = 0, b = 0]) => used.get(key(a, b)) === 1);
  const onward = new Map(edge.map(([a = 0, b = 0]) => [a, b]));
  const first = edge[0]?.[0];
  /** @type {number[]} */
  const loop = [];

  for (let at = first; at !== undefined && loop.length <= edge.length; at = onward.get(at)) {
    if (at === first && loop.length > 0) break;

    loop.push(at);
  }

  const closed = loop.length === edge.length && onward.size === edge.length;

  return closed ? loop : [];
}

/**
 * The outline of `faces` seen from above, as x and z; none unless they make one loop.
 * @param {readonly (readonly number[])[]} points
 * @param {readonly (readonly number[])[]} faces
 * @returns {number[][]}
 */
export function outline(points, faces) {
  return rim(faces).map((p) => [points[p]?.[0] ?? 0, points[p]?.[2] ?? 0]);
}
