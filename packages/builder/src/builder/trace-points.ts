// Editing a traced roof's points on the canvas (ADR 20 "Points"): a dragged point's lines where it
// would go, and the edits a dragged point, a double click on a line and Del on a tapped point make.
import {
  moveLine,
  movePoint,
  removePoint,
  replay,
  splitLine,
  type Edited,
  type PointRef,
  type Spot,
  type TraceEdit,
} from "@sunreye/scene";
import type { Scene } from "./pv.ts";
import { shifted, spotOf } from "./trace-ends.ts";
import { clickAt, type Aimed } from "./trace-aim.ts";
import { faceUnder } from "./trace-place.ts";
import type { LineRef, Placing } from "./trace-types.ts";

/** A dashed line drawn beside the scene. */
export type Dashed = { readonly from: Spot; readonly to: Spot };

/** The lines meeting point `ref`, drawn from their other ends to `to`, where it would go. */
export function pointLines(scene: Scene, ref: PointRef, to: Spot): Dashed[] {
  const lines = scene.blocks[ref.block]?.freeForm?.traced?.lines ?? [];
  const [, height] = spotOf(scene, ref);
  const at: Spot = [to[0], height, to[2]];

  return lines.flatMap(([a, b]) => {
    const other = a === ref.point ? b : b === ref.point ? a : undefined;

    return other === undefined
      ? []
      : [{ from: spotOf(scene, { block: ref.block, point: other }), to: at }];
  });
}

/** An edit and the scene it made, or why it was refused; no edit where there was none to make. */
export type Made = { edited: Edited; edit: TraceEdit | undefined };

/** A ready shape placed by a tap: a roof centred on the ground under it, a dormer on the traced
 * face drawn under it; refused off every face. */
export function readyPlaced(scene: Scene, placing: Placing, aimed: Aimed): Made {
  const { x, z } = clickAt(aimed.at);
  const face = placing.kind === "dormer" ? faceUnder(scene, { x, z }, aimed.ray) : undefined;

  const edit: TraceEdit | undefined =
    placing.kind === "roof"
      ? { ...placing, at: { x: x - placing.size.width / 2, z: z - placing.size.depth / 2 } }
      : face && { ...placing, ...face };

  return { edited: edit === undefined ? { refused: "missing" } : replay(scene, edit), edit };
}

/** Line `ref` dragged from `at` to `to`, with the straight run it lies in. */
export function lineMoved(scene: Scene, { block, line }: LineRef, at: Spot, to: Spot): Made {
  const by = { x: to[0] - at[0], z: to[2] - at[2] };

  return { edited: moveLine(scene, block, line, by), edit: { kind: "move", block, line, by } };
}

/** Line `ref` being dragged from `at` to `to`: every line the move would shift or stretch, where
 * it would go; refused, the line alone shifted. */
export function lineDragged(scene: Scene, ref: LineRef, at: Spot, to: Spot): Dashed[] {
  const { edited } = lineMoved(scene, ref, at, to);

  if ("refused" in edited) return [shifted(scene, ref, at, to)];

  const { block } = ref;
  const before = scene.blocks[block]?.freeForm?.traced?.points ?? [];
  const after = edited.scene.blocks[block]?.freeForm?.traced;

  const moved = (point: number): boolean =>
    after?.points[point]?.some((value, i) => value !== before[point]?.[i]) ?? false;

  return (after?.lines ?? []).flatMap(([a = 0, b = 0]) =>
    moved(a) || moved(b)
      ? [
          {
            from: spotOf(edited.scene, { block, point: a }),
            to: spotOf(edited.scene, { block, point: b }),
          },
        ]
      : [],
  );
}

/** Point `ref` dragged to `to`. */
export function pointMoved(scene: Scene, { block, point }: PointRef, to: Spot): Made {
  const place = { x: to[0], z: to[2] };

  return {
    edited: movePoint(scene, block, point, place),
    edit: { kind: "movePoint", block, point, to: place },
  };
}

/** Line `ref` split where `at` lies along it. */
export function lineSplit(scene: Scene, { block, line }: LineRef, at: Spot): Made {
  const place = { x: at[0], z: at[2] };

  return {
    edited: splitLine(scene, block, line, place),
    edit: { kind: "split", block, line, at: place },
  };
}

/** Point `ref` taken out. */
export function pointRemoved(scene: Scene, { block, point }: PointRef): Made {
  return { edited: removePoint(scene, block, point), edit: { kind: "removePoint", block, point } };
}
