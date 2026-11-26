// Every tracing edit named (ADR 20): one edit, as the tracing reports it, made again on a scene by
// the operation it names. Pure.

import { addLine, moveLine, removeLine } from "./roof.js";
import { pullDormer } from "./roof-dormer.js";
import { movePoint, removePoint, splitLine } from "./roof-points.js";
import { markLine, pullEaves, pullRidges, setHeight } from "./roof-pull.js";
import { placeRoof } from "./roof-ready.js";
import { removeBlock } from "./scene-blocks.js";
import { placeDormer } from "./roof-ready-dormer.js";

/** @import { Scene } from "./schema.d.ts" */
/** @import { Edited, TraceEdit } from "./roof.d.ts" */

/**
 * Each edit's operation, by its kind.
 * @type {{ [K in TraceEdit["kind"]]: (scene: Scene, edit: Extract<TraceEdit, { kind: K }>) => Edited }}
 */
const OPERATIONS = {
  add: (scene, { from, to, reach, into }) => addLine(scene, from, to, reach, into),
  move: (scene, { block, line, by }) => moveLine(scene, block, line, by),
  remove: (scene, { block, line }) => removeLine(scene, block, line),
  movePoint: (scene, { block, point, to }) => movePoint(scene, block, point, to),
  split: (scene, { block, line, at }) => splitLine(scene, block, line, at),
  removePoint: (scene, { block, point }) => removePoint(scene, block, point),
  removeBlock: (scene, { block }) => {
    const faces = scene.blocks[block]?.freeForm?.faces;

    if (faces === undefined) return { refused: "missing" };

    return {
      scene: removeBlock(scene, block),
      faces: faces.map(() => -1),
      block: -1,
      from: -1,
      to: -1,
    };
  },
  pull: (scene, { block, which, height }) =>
    (which === "eave" ? pullEaves : pullRidges)(scene, block, height),
  mark: (scene, { block, line, as }) => markLine(scene, block, line, as),
  height: (scene, { block, point, height }) => setHeight(scene, block, point, height),
  roof: (scene, { id, at, size, turn }) => placeRoof(scene, id, at, size, turn),
  dormer: (scene, { block, face, id, at, size }) => placeDormer(scene, block, face, id, at, size),
  pullDormer: (scene, { block, face, which, height }) =>
    pullDormer(scene, block, face, which, height),
};

/**
 * @param {Scene} scene
 * @param {TraceEdit} edit
 * @returns {Edited}
 */
export function replay(scene, edit) {
  // An edit from elsewhere may name what no operation is.
  if (!Object.hasOwn(OPERATIONS, edit.kind)) return { refused: "missing" };

  /** @type {(scene: Scene, edit: TraceEdit) => Edited} */
  const operation = OPERATIONS[edit.kind];

  return operation(scene, edit);
}
