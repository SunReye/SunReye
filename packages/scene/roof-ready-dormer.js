// Ready dormers (ADR 20): each placed on a face in one click as the lines a person could have
// traced, clicked with `addLine`, then pulled up by its own eaves and ridges, or marked and set as
// a person would. Pure.

import { dormers, pullDormer } from "./roof-dormer.js";
import { plane } from "./roof-heights.js";
import { within } from "./roof-nest.js";
import { onSegment, PLACE } from "./roof-plan.js";
import { markLine, setHeight } from "./roof-pull.js";
import { clicked, lineAt, pointAt } from "./roof-ready.js";
import { DORMERS } from "./roof-ready-dormer-plans.js";
import { linesOf } from "./roof-snap.js";

/** @import { Scene } from "./schema.d.ts" */
/** @import { DormerSize, Edited, Refusal } from "./roof.d.ts" */
/** @import { Flat } from "./roof-ready-plans.js" */
/** @import { DormerPlan, ReadyDormer } from "./roof-ready-dormer-plans.js" */

/** An edit of the dormer's block, given where the block's faces are now. */
/** @typedef {(scene: Scene, last: Edited, map: readonly number[]) => Edited} Step */

/** The dormer's plan on its face, and how a place across and up the face lies seen from above. */
/** @typedef {{ readonly plan: DormerPlan, readonly placed: (p: Flat) => Flat }} Seated */

export const readyDormers = DORMERS.map(({ id, de, en }) => ({ id, de, en }));

/**
 * Where a ray from `from` along `dir` first leaves the polygon `corners`, seen from above; how far.
 * @param {readonly (readonly number[])[]} corners
 * @param {Flat} from
 * @param {Flat} dir
 * @returns {number}
 */
function leaves(corners, [px, pz], [dx, dz]) {
  let best = Infinity;

  for (const [k, [ax = 0, , az = 0]] of corners.entries()) {
    const [bx = 0, , bz = 0] = corners[(k + 1) % corners.length] ?? [];
    const [ex, ez] = [bx - ax, bz - az];
    const den = dx * ez - dz * ex;

    if (Math.abs(den) < 1e-12) continue;

    const t = ((ax - px) * ez - (az - pz) * ex) / den;
    const s = ((ax - px) * dz - (az - pz) * dx) / den;

    if (t > PLACE && s >= -PLACE && s <= 1 + PLACE) best = Math.min(best, t);
  }

  return best;
}

/**
 * `list`'s places composed: where each of the block's first faces went after both edits.
 * @param {readonly number[]} map
 * @param {readonly number[]} next
 * @returns {number[]}
 */
const composed = (map, next) => map.map((f) => (f < 0 ? -1 : (next[f] ?? -1)));

/**
 * The face of `corners`'s plane, and the way up its slope seen from above with how much it rises
 * a metre along it; null for a face without slope.
 * @param {readonly (readonly number[])[]} corners
 * @returns {{ level: (x: number, z: number) => number, up: Flat, slope: number } | null}
 */
function uphill(corners) {
  const level = plane(corners);

  if (level === null) return null;

  const [dx, dz] = [level(1, 0) - level(0, 0), level(0, 1) - level(0, 0)];
  const slope = Math.hypot(dx, dz);

  return slope < 1e-6 ? null : { level, up: [dx / slope, dz / slope], slope };
}

/**
 * Dormer `dormer` on the face of `corners`, its middle at `at`: its plan and where it lies, or why
 * it does not fit.
 * @param {ReadyDormer} dormer
 * @param {readonly (readonly number[])[]} corners
 * @param {{ readonly x: number, readonly z: number }} at
 * @param {DormerSize} size
 * @returns {Seated | { readonly refused: Refusal }}
 */
function seated(dormer, corners, at, size) {
  const hill = uphill(corners);

  if (hill === null) return { refused: "short" };

  const { level, up, slope } = hill;

  // How far its front lies down the slope from its middle.
  const back =
    dormer.onEave === true ? leaves(corners, [at.x, at.z], [-up[0], -up[1]]) : size.depth / 2;

  /** @type {Flat} */
  const front = [at.x - up[0] * back, at.z - up[1] * back];
  const low = level(...front);
  const top = low + slope * size.depth;
  const eave = dormer.eave ? (size.eave ?? (low + top) / 2) : top;
  const between = eave > low + PLACE && eave < top - PLACE;

  if (!Number.isFinite(back)) return { refused: "crosses" };

  if (dormer.eave && !between) return { refused: "short" };

  return {
    plan: dormer.plan({ ...size, meet: (eave - low) / slope, eave, top }),
    placed: ([u, v]) => [front[0] - up[1] * u + up[0] * v, front[1] + up[0] * u + up[1] * v],
  };
}

/**
 * Whether every point of `seat` lies inside the face of `corners`, or on its edge for a dormer on
 * the eave.
 * @param {Seated} seat
 * @param {readonly (readonly number[])[]} corners
 * @param {boolean} onEave
 * @returns {boolean}
 */
function fits({ plan, placed }, corners, onEave) {
  /** @param {readonly number[]} p */
  const edged = (p) =>
    corners.some((a, k) => onSegment(p, a, corners[(k + 1) % corners.length] ?? a));

  return plan.paths
    .flat()
    .map((p) => placed(p))
    .every(([x, z]) => within(corners, [x, 0, z]) || (onEave && edged([x, 0, z])));
}

/**
 * The edits a person makes for `seat` on face `face` of block `block`, in order.
 * @param {Seated} seat
 * @param {number} block
 * @param {number} face
 * @returns {Step[]}
 */
function steps({ plan, placed }, block, face) {
  return [
    ...plan.paths.flatMap((path) =>
      clicked(
        path.map((p) => placed(p)),
        block,
      ),
    ),
    ...(plan.marks ?? []).map(
      ({ from, to, kind }) =>
        /** @type {Step} */
        (s) =>
          markLine(s, block, lineAt(s, block, placed(from), placed(to)), kind),
    ),
    ...(plan.heights ?? []).map(
      ({ at, height }) =>
        /** @type {Step} */
        (s) =>
          setHeight(s, block, pointAt(s, block, placed(at)), height),
    ),
    ...(plan.pulls ?? []).map(({ kind, height }) =>
      /** @type {Step} */
      (s, _, map) => {
        const own = dormers(s, block).findLast((d) => d.face === map[face]);

        return pullDormer(s, block, own?.faces[0] ?? -1, kind, height);
      },
    ),
  ];
}

/**
 * `steps` made on block `block` of `scene` one by one, the block's faces followed.
 * @param {Scene} scene
 * @param {number} block
 * @param {readonly Step[]} edits
 * @returns {Edited}
 */
function made(scene, block, edits) {
  let map = linesOf(scene.blocks[block]).faces.map((_, f) => f);
  /** @type {Edited} */
  let last = { scene, faces: map, block, from: -1, to: -1 };

  for (const edit of edits) {
    const next = edit(last.scene, last, map);

    if ("refused" in next) return next;

    // Each line is the block's: one reaching another traced roof would join it.
    if (next.block !== block) return { refused: "joins" };

    map = composed(map, next.faces);
    last = next;
  }

  return { scene: last.scene, faces: map, block, from: -1, to: -1 };
}

/**
 * @param {Scene} scene
 * @param {number} block
 * @param {number} face
 * @param {string} id
 * @param {{ readonly x: number, readonly z: number }} at
 * @param {DormerSize} size
 * @returns {Edited}
 */
export function placeDormer(scene, block, face, id, at, size) {
  const dormer = DORMERS.find((d) => d.id === id);
  const lines = linesOf(scene.blocks[block]);
  const corners = lines.faces[face]?.map((p) => lines.points[p] ?? []) ?? [];

  if (dormer === undefined || corners.length === 0) return { refused: "missing" };

  if (!(size.width > 0 && size.depth > 0)) return { refused: "short" };

  const seat = seated(dormer, corners, at, size);

  if (!("plan" in seat)) return seat;

  if (!fits(seat, corners, dormer.onEave === true)) return { refused: "crosses" };

  const edited = made(scene, block, steps(seat, block, face));

  return dormer.onEave === true ? edited : standing(edited, block, face);
}

/**
 * `edited` if it holds one new dormer standing on face `face` of block `block`, else refused.
 * @param {Edited} edited
 * @param {number} block
 * @param {number} face
 * @returns {Edited}
 */
function standing(edited, block, face) {
  if ("refused" in edited) return edited;

  const kept = new Set(edited.faces);
  const own = dormers(edited.scene, block).filter((d) => d.faces.every((f) => !kept.has(f)));

  return own.length === 1 && own[0]?.face === edited.faces[face] ? edited : { refused: "crosses" };
}
