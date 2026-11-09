// Edits of a scene in the builder: new blocks and obstacles, and roof changes (ADR 20).
import type { Block, Obstacle, Roof } from "./pv.ts";

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

  return kind === "tree"
    ? { kind, x: -5, z: 10, radius: 2, height: 8 }
    : { kind, x: 2, z: 2, radius: 0.3, height: 8 };
}
