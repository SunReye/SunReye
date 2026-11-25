// Tracing a roof (ADR 20): a scene in, the next scene out. A traced block's lines are its source;
// each edit derives its faces again from their closed loops (`rebuild`). Pure: no browser, no 3D.
// Pulling up is roof-pull.js's, dormers roof-dormer.js's, ready roofs roof-ready.js's: each an
// edit of a block's lines handed to `rebuild`.

import { rebuild, withoutBlock } from "./roof-faces.js";
import { within } from "./roof-nest.js";
import { PLACE, along, apart, between, crossing, onSegment, touching } from "./roof-plan.js";
import { linesOf, snap, spot } from "./roof-snap.js";

export { loops } from "./roof-plan.js";

export { snap } from "./roof-snap.js";

/** @import { Scene } from "./schema.d.ts" */
/** @import { Edited, End, Spot } from "./roof.d.ts" */

/** @import { Lines } from "./roof-faces.js" */
/**
 * Where an end lands, the block it names, and whether it sets its point's height; undefined for a
 * point that is not there.
 * @param {Scene} scene
 * @param {End} end
 * @param {number} reach
 * @returns {{ readonly at: Spot, readonly block: number | undefined, readonly set: boolean } | undefined}
 */
function landing(scene, end, reach) {
  if ("point" in end) {
    const at = scene.blocks[end.block]?.freeForm?.traced?.points[end.point];

    return at && { at: spot(at), block: end.block, set: false };
  }

  const snapped = snap(scene, end, reach);

  return {
    at: snapped.at,
    block: snapped.kind === "free" ? undefined : snapped.block,
    set: snapped.kind === "free" && end.height !== undefined,
  };
}

/**
 * `lines` with a point at `at`, added when there is none and splitting the line it lies on, and
 * that point.
 * @param {Lines} lines
 * @param {Spot} at
 * @param {boolean} set
 * @returns {{ readonly lines: Lines, readonly point: number }}
 */
function withPoint(lines, at, set) {
  const found = lines.points.findIndex((p) => apart(p, at) < PLACE);

  if (found >= 0) return { lines, point: found };

  const point = lines.points.length;

  const on = lines.lines.findIndex(([i = 0, j = 0]) =>
    onSegment(at, lines.points[i] ?? [], lines.points[j] ?? []),
  );

  const [i = 0, j = 0] = lines.lines[on] ?? [];

  /** A point splitting a line the person made an eave or a ridge is one too.
   * @param {readonly number[]} list */
  const named = (list) =>
    on >= 0 && list.includes(i) && list.includes(j) ? [...list, point] : list;

  const split =
    on >= 0
      ? [...lines.lines.slice(0, on), [i, point], [point, j], ...lines.lines.slice(on + 1)]
      : lines.lines;

  return {
    lines: {
      ...lines,
      points: [...lines.points, at],
      // A point splitting a line between two set points is set, at its height along it.
      set:
        set || (on >= 0 && lines.set.includes(i) && lines.set.includes(j))
          ? [...lines.set, point]
          : lines.set,
      lines: split,
      eaves: named(lines.eaves),
      ridges: named(lines.ridges),
    },
    point,
  };
}

/**
 * `lines` with a line from point `from` to point `to`, split where it crosses a line or passes a
 * point; a stretch already drawn is not drawn again.
 * @param {Lines} lines
 * @param {number} from
 * @param {number} to
 * @returns {Lines}
 */
function joined(lines, from, to) {
  const a = lines.points[from] ?? [];
  const b = lines.points[to] ?? [];

  const crossings = lines.lines.flatMap(([i = 0, j = 0]) => {
    const c = lines.points[i] ?? [];
    const d = lines.points[j] ?? [];
    const cut = crossing(a, b, c, d);

    return cut ? [between(c, d, cut[1])] : [];
  });

  /** @type {Lines} */
  const split = crossings.reduce((next, at) => withPoint(next, at, false).lines, lines);

  const chain = split.points.flatMap((p, i) =>
    i === from || i === to || onSegment(p, a, b) ? [i] : [],
  );

  // roof.d.ts stands for this file in the type checker, which reads it without the newest arrays.
  chain.sort((p, q) => along(split.points[p] ?? [], a, b) - along(split.points[q] ?? [], a, b));

  /**
   * @param {number} p
   * @param {number} q
   */
  const drawn = (p, q) =>
    split.lines.some(([i, j]) => (i === p && j === q) || (i === q && j === p));

  const added = chain.slice(1).flatMap((q, k) => {
    const p = chain[k] ?? q;

    return drawn(p, q) ? [] : [[p, q]];
  });

  return { ...split, lines: [...split.lines, ...added] };
}

/**
 * The traced blocks whose lines the segment from `a` to `b` crosses.
 * @param {Scene} scene
 * @param {Spot} a
 * @param {Spot} b
 * @returns {number[]}
 */
function crossed(scene, a, b) {
  return [...scene.blocks.keys()].filter((index) => {
    const { points, lines } = linesOf(scene.blocks[index]);

    return lines.some(([i = 0, j = 0]) => crossing(a, b, points[i] ?? [], points[j] ?? []));
  });
}

/**
 * The traced block one of whose faces `at` lies inside, seen from above; a dormer is traced there.
 * @param {Scene} scene
 * @param {Spot} at
 * @returns {number | undefined}
 */
function under(scene, at) {
  const found = scene.blocks.findIndex(
    (block) =>
      block.freeForm?.traced !== undefined && block.freeForm.faces.some((face) => within(face, at)),
  );

  return found >= 0 ? found : undefined;
}

/**
 * The block a line from `start` to `end` goes into: `into` where the person named one, a new block
 * for `"new"`; else the one traced block it ends on, crosses or lies inside, a new one for none.
 * Undefined where it would join two, or names a block that is no traced roof.
 * @param {Scene} scene
 * @param {Spot} start
 * @param {Spot} end
 * @param {readonly (number | undefined)[]} ends the blocks its ends snapped to
 * @param {number | "new" | undefined} into
 * @returns {{ readonly block: number } | { readonly refused: "joins" | "missing" }}
 */
function intoBlock(scene, start, end, ends, into) {
  if (into === "new") return { block: scene.blocks.length };

  if (into !== undefined) {
    return scene.blocks[into]?.freeForm?.traced === undefined
      ? { refused: "missing" }
      : { block: into };
  }

  const touched = [
    ends[0] ?? under(scene, start),
    ends[1] ?? under(scene, end),
    ...crossed(scene, start, end),
  ];

  const named = new Set(touched.filter((b) => b !== undefined));

  if (named.size > 1) return { refused: "joins" };

  return { block: [...named][0] ?? scene.blocks.length };
}

/**
 * @param {Scene} scene
 * @param {End} from
 * @param {End} to
 * @param {number} reach
 * @param {number | "new"} [into]
 * @returns {Edited}
 */
export function addLine(scene, from, to, reach, into) {
  const start = landing(scene, from, reach);
  const end = landing(scene, to, reach);

  if (start === undefined || end === undefined) return { refused: "missing" };

  const target = intoBlock(scene, start.at, end.at, [start.block, end.block], into);

  if ("refused" in target) return target;

  if (apart(start.at, end.at) < PLACE) return { refused: "short" };

  const { block } = target;
  const first = withPoint(linesOf(scene.blocks[block]), start.at, start.set);
  const last = withPoint(first.lines, end.at, end.set);
  const lines = joined(last.lines, first.point, last.point);

  return { ...rebuild(scene, block, lines), block, from: first.point, to: last.point };
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} line
 * @param {{ readonly x: number, readonly z: number }} by
 * @returns {Edited}
 */
export function moveLine(scene, block, line, by) {
  const lines = linesOf(scene.blocks[block]);
  const [a, b] = lines.lines[line] ?? [];

  if (a === undefined || b === undefined) return { refused: "missing" };

  const points = lines.points.map((p, i) =>
    i === a || i === b ? [(p[0] ?? 0) + by.x, p[1] ?? 0, (p[2] ?? 0) + by.z] : p,
  );

  const moved = { ...lines, points };

  const tangled = moved.lines.some((l, i) =>
    moved.lines.slice(i + 1).some((m) => touching(points, l, m)),
  );

  if (tangled) return { refused: "crosses" };

  return { ...rebuild(scene, block, moved), block, from: a, to: b };
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} line
 * @returns {Edited}
 */
export function removeLine(scene, block, line) {
  const lines = linesOf(scene.blocks[block]);

  if (lines.lines[line] === undefined) return { refused: "missing" };

  const left = lines.lines.filter((_, i) => i !== line);

  if (left.length === 0) {
    const faces = lines.faces.map(() => -1);

    return { scene: withoutBlock(scene, block), faces, block: -1, from: -1, to: -1 };
  }

  const used = [...lines.points.keys()].filter((p) => left.some((l) => l.includes(p)));
  const renamed = new Map(used.map((p, i) => [p, i]));

  /** @param {number} p */
  const rename = (p) => {
    const now = renamed.get(p);

    return now === undefined ? [] : [now];
  };

  const kept = {
    points: used.map((p) => lines.points[p] ?? []),
    set: lines.set.flatMap((p) => rename(p)),
    lines: left.map((l) => l.flatMap((p) => rename(p))),
    faces: lines.faces.map((f) => f.flatMap((p) => rename(p))),
    eaves: lines.eaves.flatMap((p) => rename(p)),
    ridges: lines.ridges.flatMap((p) => rename(p)),
  };

  return { ...rebuild(scene, block, kept), block, from: -1, to: -1 };
}
