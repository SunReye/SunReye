// The line being traced turned onto a direction it nearly takes (#74), by the chain's lines and the
// traced lines near the pointer: angle-snap.ts in the scene's spots.
import { angleSnap } from "./angle-snap.ts";
import { distance, type Plan } from "./plan.ts";
import type { Scene } from "./pv.ts";
import type { Snap, Spot } from "@sunreye/scene";
import type { Aimed } from "./trace-aim.ts";
import { snapOf, spotOf } from "./trace-ends.ts";

/** A guide the line being drawn snapped to: through its corner, and its angle in degrees. */
export interface Guide {
  readonly from: Spot;
  readonly to: Spot;
  readonly angle: number;
}

/** Snap reaches within which a traced line steers the line being drawn. */
const NEAR = 10;

/** The unit direction from `a` to `b` seen from above; undefined for none. */
function direction(a: readonly number[], b: readonly number[]): Plan | undefined {
  const [dx, dz] = [(b[0] ?? 0) - (a[0] ?? 0), (b[2] ?? 0) - (a[2] ?? 0)];
  const length = Math.hypot(dx, dz);

  return length === 0 ? undefined : [dx / length, dz / length];
}

/** The directions of the traced lines within `near` metres of `at`. */
function edgesNear(scene: Scene, [x, , z]: Spot, near: number): Plan[] {
  return scene.blocks.flatMap((block) => {
    const traced = block.freeForm?.traced;

    return (traced?.lines ?? []).flatMap(([a = 0, b = 0]) => {
      const [p = [], q = []] = [traced?.points[a], traced?.points[b]];

      const from: Plan = [p[0] ?? 0, p[2] ?? 0];
      const to: Plan = [q[0] ?? 0, q[2] ?? 0];
      const along = distance([x, z], from, to) <= near ? direction(p, q) : undefined;

      return along === undefined ? [] : [along];
    });
  });
}

/** Where the line from `from` to `aimed` ends turned onto a direction, and its guide; undefined
 * when it nearly takes none. */
function turned(
  scene: Scene,
  aimed: Aimed,
  from: Spot,
  chain: { readonly previous: Plan | undefined; readonly first: Plan | undefined },
): { at: Spot; guide: Guide } | undefined {
  const { at, reach } = aimed;
  const edges = edgesNear(scene, at, reach * NEAR);
  const angled = angleSnap([from[0], from[2]], [at[0], at[2]], { ...chain, edges });

  if (angled === undefined) return undefined;

  const [[ax, az], [bx, bz]] = angled.guide;

  return {
    at: [angled.at[0], at[1], angled.at[1]],
    guide: { from: [ax, 0, az], to: [bx, 0, bz], angle: angled.angle },
  };
}

/** What a pointer snaps to, and the guide of the direction it was turned onto. */
export type Snapped = Readonly<{ snap: Snap; guide: Guide | undefined }>;

/** What `aimed` snaps to: a traced point or line, else, drawing on from `from` and not `free`, a
 * direction the line nearly takes (angle-snap.ts); with the guide it took. */
export function snappedFrom(
  scene: Scene,
  aimed: Aimed,
  from: Spot | undefined,
  chain: { readonly previous: Plan | undefined; readonly first: Plan | undefined },
): Snapped {
  const snapped = snapOf(scene, aimed);

  if (snapped.kind !== "free" || from === undefined || aimed.free === true)
    return { snap: snapped, guide: undefined };

  const angled = turned(scene, aimed, from, chain);

  return angled === undefined
    ? { snap: snapped, guide: undefined }
    : { snap: { kind: "free", at: angled.at }, guide: angled.guide };
}

/** A traced line, by its block and its two points, in the scene that has it. */
export type Edge = Readonly<{ block: number; from: number; to: number; scene: Scene }>;

/** Line `edge`'s direction seen from above. */
export const bearing = ({ block, from, to, scene }: Edge): Plan | undefined =>
  direction(spotOf(scene, { block, point: from }), spotOf(scene, { block, point: to }));
