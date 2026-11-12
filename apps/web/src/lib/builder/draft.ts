// Edits of a scene in the builder: new blocks, obstacles and surroundings, roof changes and fence
// points (ADR 20).
import type { Block, Fence, GroundSurface, Obstacle, Roof } from "./pv.ts";

/** Metres between a new block and the last one. */
const GAP = 2;
/** Degrees: a common pitch for central European roofs. */

const PITCH = 35;

/** A 10 m × 8 m gable house, at the origin or beside the last block. */
export function nextBlock(blocks: readonly Block[]): Block {
  const last = blocks.at(-1);

  return {
    x: last === undefined ? 0 : last.x + last.width + GAP,
    z: last?.z ?? 0,
    width: 10,
    depth: 8,
    eave: 3,
    rotation: 0,
    roof: { kind: "gable", pitch: PITCH },
  };
}

/** `roof` as `kind`, keeping its pitch where both have one. */
export function withRoof(roof: Roof, kind: Roof["kind"]): Roof {
  if (kind === "flat") return { kind };

  return { kind, pitch: roof.kind === "flat" ? PITCH : roof.pitch };
}

/** A new obstacle in front of the first block. */
export function obstacle(kind: Obstacle["kind"]): Obstacle {
  if (kind === "box") return { kind, x: 0, z: 12, width: 4, depth: 1, height: 2, rotation: 0 };

  if (kind === "hedge") {
    return { kind, x: -2, z: 15, length: 8, depth: 0.8, height: 1.8, rotation: 0 };
  }

  return kind === "tree"
    ? { kind, x: -5, z: 10, radius: 2, height: 8, crown: "broadleaf" }
    : { kind, x: 2, z: 2, radius: 0.3, height: 8 };
}

/** A new patch of paving in front of the first block. */
export function surface(): GroundSurface {
  return { x: 0, z: 9, width: 4, depth: 5, rotation: 0, finish: "paving" };
}

/** A new wooden fence along the front of the plot. */
export function fence(): Fence {
  return {
    points: [
      { x: -6, z: 17 },
      { x: 16, z: 17 },
    ],
    height: 1.2,
    finish: "wood",
  };
}

/** Metres a new fence point lies on from the last. */
const ONWARD = 3;

/** The fence with a point `ONWARD` metres on along its last stretch. */
export function lengthened(item: Fence): Fence {
  const origin = { x: 0, z: 0 };
  const [last, before] = [item.points.at(-1) ?? origin, item.points.at(-2) ?? origin];
  const [dx, dz] = [last.x - before.x, last.z - before.z];
  const length = Math.hypot(dx, dz) || 1;

  return {
    ...item,
    points: [
      ...item.points,
      { x: last.x + (dx / length) * ONWARD, z: last.z + (dz / length) * ONWARD },
    ],
  };
}

/** The fence without its last point; a fence keeps two. */
export function shortened(item: Fence): Fence {
  return item.points.length > 2 ? { ...item, points: item.points.slice(0, -1) } : item;
}
