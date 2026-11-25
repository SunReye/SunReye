// Whether a press struck the selected object's own surface, which moves it whole (ADR 20).
import { picked, type Level } from "../levels.ts";
import type { Point } from "../pv.ts";
import type { Hit } from "../scene.ts";
import type { Editing } from "./grabbing.ts";
import type { Target } from "./grips.ts";

export const same = (a: Target, b: { readonly kind: string; readonly index?: number }): boolean =>
  a.kind === b.kind && a.index === b.index;

/** Whether `level` is part of block `index`: the block, or one of its faces. */
const ofBlock = (level: Level, index: number): boolean =>
  (level.kind === "block" && level.index === index) ||
  (level.kind === "face" && level.block === index);

/** Whether a press on `level` moves the selected object whole. A block's surface does only where
 * the editor says (`wholeBlock`), and a fence has none. */
function moves(level: Level, { target, wholeBlock }: Editing): boolean {
  if (target.kind === "block") return wholeBlock === true && ofBlock(level, target.index);

  return target.kind !== "fence" && same(target, level);
}

/** Where a press `hit` the selected object's own surface, which moves it whole; none for anything
 * else. */
export function bodyAt(hit: Hit | null | undefined, editing: Editing): Point | undefined {
  if (hit?.kind !== "point" && hit?.kind !== "obstacle") return undefined;

  const level = picked(editing.scene, hit, editing.pv);

  return level !== null && moves(level, editing) ? hit.point : undefined;
}
