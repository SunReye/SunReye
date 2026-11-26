// A traced block's handles beyond its ring (ADR 20): on a rectangle, as a ready roof is placed, a
// width and a depth arrow that stretch it from the side across; and its move, which shifts the
// whole of it. Pure and three.js-free.
import { moveBlock, rectangleOf, stretchBlock } from "@sunreye/scene";
import type { Scene } from "../pv.ts";
import type { Target } from "./body.ts";
import { clamp, snap, tidy, world, type Triple } from "./frame.ts";

/** Metres an arrow stands off its side, and above the ground: as a block's. */
const OFF = 0.8;
const LOW = 0.3;

/** The lengths a stretch keeps to, and the step it snaps in, in metres. */
const SHORTEST = 1;
const LONGEST = 60;
const STEP = 0.1;

/** A level drag of `target` in the scene's frame, from `from` to `to`. */
export interface Slide {
  readonly scene: Scene;
  readonly target: Target;
  readonly from: Triple;
  readonly to: Triple;
}

/** A width arrow beyond traced block `target`'s second side and a depth arrow beyond its third,
 * where its footprint is a rectangle; none else. */
export function tracedArrows(scene: Scene, target: Target) {
  const rect = target.kind === "block" ? rectangleOf(scene.blocks[target.index]) : null;

  if (rect === null) return [];

  const {
    corner: [cx, cz],
    axes: [[ux, uz], [vx, vz]],
    lengths: [u, v],
  } = rect;

  const point = (along: number, across: number) =>
    world(scene.north, [cx + ux * along + vx * across, LOW, cz + uz * along + vz * across]);

  return [
    {
      grip: "width" as const,
      at: point(u + OFF, v / 2),
      axis: world(scene.north, [ux, 0, uz]),
      edge: point(u, v / 2),
      span: u,
    },
    {
      grip: "depth" as const,
      at: point(u / 2, v + OFF),
      axis: world(scene.north, [vx, 0, vz]),
      edge: point(u / 2, v),
      span: v,
    },
  ];
}

/** A traced block's level drag: a move shifts the whole of it, an arrow stretches it; both snapped. */
export function tracedSlid({ scene, target, from, to }: Slide, grip: string) {
  const index = target.kind === "block" && scene.blocks[target.index] ? target.index : undefined;

  if (index === undefined) return null;

  if (grip === "move") {
    const by = [snap(to[0] - from[0], STEP), snap(to[2] - from[2], STEP)].map((value) =>
      tidy(value),
    );

    return { scene: moveBlock(scene, index, by), value: by, unit: "m" as const };
  }

  const rect = rectangleOf(scene.blocks[index]);
  const side = grip === "width" ? 0 : grip === "depth" ? 1 : undefined;

  if (rect === null || side === undefined) return null;

  const [ax, az] = rect.axes[side];
  const shift = (to[0] - from[0]) * ax + (to[2] - from[2]) * az;
  const length = clamp(snap(rect.lengths[side] + shift, STEP), SHORTEST, LONGEST);

  return { scene: stretchBlock(scene, index, side, length), value: [length], unit: "m" as const };
}
