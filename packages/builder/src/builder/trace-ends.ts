// A tracing click's ends (ADR 20): what an aimed pointer snaps to, where a click ends a line, and a
// dragged line's new place.
import { snap, type End, type PointRef, type Snap, type Spot } from "@sunreye/scene";
import { clickAt, type Aimed } from "./trace-aim.ts";
import type { Scene } from "./pv.ts";
import type { LineRef } from "./tracing.svelte.ts";

/** A traced point's spot. */
export function spotOf(scene: Scene, { block, point }: PointRef): Spot {
  const [x = 0, y = 0, z = 0] = scene.blocks[block]?.freeForm?.traced?.points[point] ?? [];

  return [x, y, z];
}

/** Line `line` shifted level by the move from `from` to `to`. */
export function shifted(scene: Scene, { block, line }: LineRef, from: Spot, to: Spot) {
  const [a = 0, b = 0] = scene.blocks[block]?.freeForm?.traced?.lines[line] ?? [];

  const by = (point: number): Spot => {
    const [x, y, z] = spotOf(scene, { block, point });

    return [x + to[0] - from[0], y, z + to[2] - from[2]];
  };

  return { from: by(a), to: by(b) };
}

/** What an aimed pointer snaps to: what it picks as drawn, else by the ground under it. */
export function snapOf(scene: Scene, { at, reach, snap: picked }: Aimed): Snap {
  return picked ?? snap(scene, clickAt(at), reach);
}

/** Where a click ends a line: the traced point it snaps to, a place on the line it snaps to, else
 * the click itself. */
export function ended(scene: Scene, aimed: Aimed): End {
  const snapped = snapOf(scene, aimed);

  if (snapped.kind === "point") return { block: snapped.block, point: snapped.point };

  // A line's place by its plan, where the scene's operations snap it to the line again.
  return snapped.kind === "line" ? { x: snapped.at[0], z: snapped.at[2] } : clickAt(aimed.at);
}

/** Whether two ends are the same traced point. */
export const samePoint = (a: End, b: End): boolean =>
  "point" in a && "point" in b && a.block === b.block && a.point === b.point;
