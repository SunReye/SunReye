// A tracing click's ends (ADR 20): what an aimed pointer snaps to, where a click ends a line, and a
// dragged line's new place.
import { snap, type End, type PointRef, type Snap, type Spot } from "@sunreye/scene";
import { clickAt, type Aimed } from "./trace-aim.ts";
import type { Scene } from "./pv.ts";
import type { Guide } from "./trace-angle.ts";
import type { LineRef } from "./trace-types.ts";

/** Where chain end `end` stands in `scene`; none without either. */
export function endSpot(scene: Scene | undefined, end: End | undefined): Spot | undefined {
  if (end === undefined || scene === undefined) return undefined;

  return "point" in end ? spotOf(scene, end) : [end.x, end.height ?? 0, end.z];
}

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

/** Where a click ends a line: the traced point it snaps to, a place on the line it snaps to, the
 * direction it was turned onto, else the click itself. */
export function ended(
  { snap: snapped, guide }: Readonly<{ snap: Snap; guide: Guide | undefined }>,
  aimed: Aimed,
): End {
  if (snapped.kind === "point") return { block: snapped.block, point: snapped.point };

  // A line's place by its plan, where the scene's operations snap it to the line again.
  if (snapped.kind === "line") return { x: snapped.at[0], z: snapped.at[2] };

  return clickAt(guide === undefined ? aimed.at : snapped.at);
}

/** Whether two ends are the same traced point. */
export const samePoint = (a: End, b: End): boolean =>
  "point" in a && "point" in b && a.block === b.block && a.point === b.point;
