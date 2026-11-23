// Dormers (ADR 20): a closed loop traced inside a face is a small roof of its own, standing on that
// face. Each is named, and pulled up by its own eaves and ridges, never below its face. Pure.

import { rebuild } from "./roof-faces.js";
import { kinds, plane } from "./roof-heights.js";
import { PLACE } from "./roof-plan.js";
import { hosts } from "./roof-nest.js";
import { linesOf } from "./roof-snap.js";

/** @import { Scene } from "./schema.d.ts" */
/** @import { Dormer, Edited, Kind } from "./roof.d.ts" */
/** @import { Lines } from "./roof-faces.js" */

/**
 * The dormers of `lines`: the faces standing on one face, grouped where they share a point.
 * @param {Lines} lines
 * @returns {Dormer[]}
 */
function grouped(lines) {
  const on = hosts(lines.points, lines.faces);
  /** @type {Dormer[]} */
  const found = [];

  for (const [g, host] of on.entries()) {
    const face = lines.faces[g] ?? [];

    /** @param {Dormer} d */
    const joins = (d) =>
      d.face === host && d.faces.some((f) => (lines.faces[f] ?? []).some((p) => face.includes(p)));

    const near = found.filter((d) => joins(d));

    const rest = found.filter((d) => !joins(d));

    if (host >= 0)
      found.splice(0, found.length, ...rest, {
        face: host,
        faces: [...near.flatMap((d) => d.faces), g].toSorted((a, b) => a - b),
      });
  }

  return found.toSorted((a, b) => (a.faces[0] ?? 0) - (b.faces[0] ?? 0));
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @returns {Dormer[]}
 */
export function dormers(scene, block) {
  return grouped(linesOf(scene.blocks[block]));
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} face
 * @param {Kind} kind
 * @param {number} height
 * @returns {Edited}
 */
export function pullDormer(scene, block, face, kind, height) {
  const lines = linesOf(scene.blocks[block]);
  const dormer = grouped(lines).find((d) => d.faces.includes(face));

  if (dormer === undefined || !Number.isFinite(height)) return { refused: "missing" };

  const own = new Set(dormer.faces.flatMap((f) => lines.faces[f] ?? []));
  const faces = dormer.faces.map((f) => lines.faces[f] ?? []);

  const of = kinds({
    ...lines,
    faces,
    lines: lines.lines.filter((l) => l.every((p) => own.has(p))),
    eaves: [],
    ridges: [],
  });

  const level =
    plane((lines.faces[dormer.face] ?? []).map((p) => lines.points[p] ?? [])) ?? (() => 0);

  /** Each of the dormer's points of `kind` at `height`, or on its face where that is higher. */
  const pulled = lines.points.map((p, i) => {
    const [x = 0, , z = 0] = p;
    const floor = level(x, z);

    return own.has(i) && of[i] === kind
      ? { at: [x, Math.max(floor, height), z], up: height > floor + PLACE }
      : undefined;
  });

  const points = lines.points.map((p, i) => pulled[i]?.at ?? p);
  const raised = [...pulled.keys()].filter((i) => pulled[i]?.up === true);

  const set = [...lines.set.filter((p) => pulled[p] === undefined), ...raised];

  return { ...rebuild(scene, block, { ...lines, points, set }), block, from: -1, to: -1 };
}
