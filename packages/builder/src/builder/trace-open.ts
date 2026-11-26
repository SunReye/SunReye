// Outlines left open on the canvas (ADR 20 "Points"): a block traced with no face is no roof, so
// the chain that made it takes it out when it ends unclosed, and the next chain takes out every one
// left before. Each is one edit, which Ctrl+Z brings back.
import { replay, type End } from "@sunreye/scene";
import type { Scene } from "./pv.ts";
import type { Made } from "./trace-points.ts";

/** The edits taking out outlines left open, each on the scene the last left, and where a chain
 * starts after them. */
export interface Swept {
  readonly made: readonly Made[];
  readonly start: End;
}

/** Whether block `block` is an outline left open: lines traced, no face. */
function open(scene: Scene, block: number): boolean {
  const form = scene.blocks[block]?.freeForm;

  return form?.traced !== undefined && form.faces.length === 0;
}

/** Block `block` taken out when it is an outline left open; none else. */
export function openDropped(scene: Scene, block: number | undefined): Made | undefined {
  if (block === undefined || !open(scene, block)) return undefined;

  const edit = { kind: "removeBlock", block } as const;

  return { edited: replay(scene, edit), edit };
}

/** Blocks `blocks` taken out one after another, each edit on the scene the last left. */
function swept(scene: Scene, blocks: readonly number[]): readonly Made[] {
  const [block, ...rest] = blocks;

  if (block === undefined) return [];

  const dropped = openDropped(scene, block);

  if (dropped === undefined || "refused" in dropped.edited) return swept(scene, rest);

  return [dropped, ...swept(dropped.edited.scene, rest)];
}

/** A chain starting at `end`: every outline left open taken out but the one it starts on, the
 * last first so the others keep their numbers, and `end` where it is after. None while tracing
 * into a roof, which is named by a number taking out another would change. */
export function openSwept(scene: Scene, end: End, into: number | "new" | undefined): Swept {
  if (into !== undefined && into !== "new") return { made: [], start: end };

  const keep = "point" in end ? end.block : undefined;

  const blocks = scene.blocks.flatMap((_, block) =>
    block !== keep && open(scene, block) ? [block] : [],
  );

  const made = swept(scene, blocks.toReversed());

  const before = blocks.filter((block) => keep !== undefined && block < keep).length;

  return { made, start: "point" in end ? { ...end, block: end.block - before } : end };
}
