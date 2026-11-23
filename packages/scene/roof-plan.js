// A traced roof seen from above (ADR 20): its lines' closed loops, the outline they make, and the
// plane geometry an edit measures with. Pure.

/** @import { Spot } from "./roof.d.ts" */
/** Metres within which two places are one. */
export const PLACE = 1e-6;

/** Twice a loop's least area, in square metres, to be a face. */
const AREA = 1e-9;

/**
 * How far apart two places are seen from above.
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @returns {number}
 */
export function apart(a, b) {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/**
 * How far along `a`–`b` the place nearest `p` lies, from 0 at `a` to 1 at `b`, seen from above.
 * @param {readonly number[]} p
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @returns {number}
 */
export function along(p, a, b) {
  const [ax = 0, , az = 0] = a;
  const dx = (b[0] ?? 0) - ax;
  const dz = (b[2] ?? 0) - az;
  const length = dx * dx + dz * dz;

  return length === 0 ? 0 : (((p[0] ?? 0) - ax) * dx + ((p[2] ?? 0) - az) * dz) / length;
}

/**
 * The place `t` of the way from `a` to `b`, its height too.
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @param {number} t
 * @returns {Spot}
 */
export function between(a, b, t) {
  /** @param {number} i */
  const at = (i) => (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t;

  return [at(0), at(1), at(2)];
}

/**
 * Whether `t` lies strictly inside a segment, clear of its ends.
 * @param {number} t
 * @returns {boolean}
 */
const inside = (t) => t > PLACE && t < 1 - PLACE;

/**
 * Where segments `a`–`b` and `c`–`d` cross seen from above, as how far along each, both clear of
 * their ends; undefined where they do not.
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @param {readonly number[]} c
 * @param {readonly number[]} d
 * @returns {readonly [number, number] | undefined}
 */
export function crossing(a, b, c, d) {
  const [ax = 0, , az = 0] = a;
  const [cx = 0, , cz = 0] = c;
  const rx = (b[0] ?? 0) - ax;
  const rz = (b[2] ?? 0) - az;
  const sx = (d[0] ?? 0) - cx;
  const sz = (d[2] ?? 0) - cz;
  const denominator = rx * sz - rz * sx;

  const t = ((cx - ax) * sz - (cz - az) * sx) / denominator;
  const u = ((cx - ax) * rz - (cz - az) * rx) / denominator;

  return Math.abs(denominator) >= AREA && inside(t) && inside(u) ? [t, u] : undefined;
}

/**
 * Whether `p` lies on segment `a`–`b` seen from above, its ends included.
 * @param {readonly number[]} p
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @returns {boolean}
 */
export function onSegment(p, a, b) {
  const t = along(p, a, b);

  return t >= 0 && t <= 1 && apart(between(a, b, t), p) < PLACE;
}

/**
 * Whether lines `l` and `m` between `points`, which share no point, touch seen from above.
 * @param {readonly (readonly number[])[]} points
 * @param {readonly number[]} l
 * @param {readonly number[]} m
 * @returns {boolean}
 */
export function touching(points, l, m) {
  if (l.some((p) => m.includes(p))) return false;

  const [a = [], b = [], c = [], d = []] = [l[0], l[1], m[0], m[1]].map(
    (p) => points[p ?? 0] ?? [],
  );

  return (
    crossing(a, b, c, d) !== undefined ||
    onSegment(a, c, d) ||
    onSegment(b, c, d) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b)
  );
}

/**
 * Twice the signed area of a loop seen from above, positive turning from +x toward +z.
 * @param {readonly (readonly number[])[]} points
 * @param {readonly number[]} loop
 * @returns {number}
 */
export function area(points, loop) {
  let sum = 0;

  for (const [k, i] of loop.entries()) {
    const [x = 0, , z = 0] = points[i] ?? [];
    const [nx = 0, , nz = 0] = points[loop[(k + 1) % loop.length] ?? 0] ?? [];

    sum += x * nz - nx * z;
  }

  return sum;
}

/**
 * Each point's neighbours along `lines`, by point, without the lines that end nowhere: those close
 * no loop.
 * @param {number} count
 * @param {readonly (readonly number[])[]} lines
 * @returns {(readonly number[])[]}
 */
function closing(count, lines) {
  /** @type {(readonly number[])[]} */
  const next = Array.from({ length: count }, () => []);

  for (const [a = 0, b = 0] of lines) {
    next[a] = [...(next[a] ?? []), b];
    next[b] = [...(next[b] ?? []), a];
  }

  for (let end = next.findIndex((to) => to.length === 1); end >= 0;) {
    const [other = -1] = next[end] ?? [];

    next[end] = [];
    next[other] = (next[other] ?? []).filter((p) => p !== end);
    end = next.findIndex((to) => to.length === 1);
  }

  return next;
}

/**
 * The walk from `start` toward `first` that turns as far right as it can at each point, back to
 * where it began: a bounded face's walk then turns from +x toward +z.
 * @param {readonly (readonly number[])[]} round
 * @param {number} start
 * @param {number} first
 * @returns {number[]}
 */
function walk(round, start, first) {
  /** @type {number[]} */
  const steps = [];
  let [from, to] = [start, first];

  do {
    steps.push(from);

    const around = round[to] ?? [];
    const back = around.indexOf(from);

    [from, to] = [to, around[(back - 1 + around.length) % around.length] ?? from];
  } while ((from !== start || to !== first) && steps.length <= round.length);

  return steps;
}

/**
 * Whether a walk goes round a face: no point twice, and turning from +x toward +z.
 * @param {readonly (readonly number[])[]} points
 * @param {readonly number[]} steps
 * @returns {boolean}
 */
function bounded(points, steps) {
  return steps.length >= 3 && new Set(steps).size === steps.length && area(points, steps) > AREA;
}

/**
 * @param {readonly (readonly number[])[]} points
 * @param {readonly (readonly number[])[]} lines
 * @returns {number[][]}
 */
export function loops(points, lines) {
  /**
   * @param {number} from
   * @param {number} to
   */
  const heading = (from, to) => {
    const [fx = 0, , fz = 0] = points[from] ?? [];
    const [tx = 0, , tz = 0] = points[to] ?? [];

    return Math.atan2(tz - fz, tx - fx);
  };

  const round = closing(points.length, lines).map((to, point) =>
    to.toSorted((p, q) => heading(point, p) - heading(point, q)),
  );

  /** @type {Set<string>} */
  const walked = new Set();
  /** @type {number[][]} */
  const found = [];

  for (const [start, ends] of round.entries())
    for (const first of ends.filter((end) => !walked.has(`${start}>${end}`))) {
      const steps = walk(round, start, first);

      for (const [k, from] of steps.entries())
        walked.add(`${from}>${steps[(k + 1) % steps.length] ?? from}`);

      if (bounded(points, steps)) found.push(steps.toReversed());
    }

  return found;
}

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
