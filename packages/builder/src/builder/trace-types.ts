// What the tracing mode (tracing.svelte.ts) takes from its consumer and shows beside the scene.
import type { DormerSize, Refusal, RoofSize, Snap, Spot, TraceEdit } from "@sunreye/scene";
import type { Scene } from "./pv.ts";
import type { Guide } from "./trace-angle.ts";

/** A traced line, by its block and its place in the block's lines. */
export interface LineRef {
  readonly block: number;
  readonly line: number;
}

/** A ready shape held for placing: the next tap places it, a roof centred on it, a dormer on the
 * traced face under it, its middle there. */
export type Placing =
  | { readonly kind: "roof"; readonly id: string; readonly size: RoofSize }
  | { readonly kind: "dormer"; readonly id: string; readonly size: DormerSize };

/** The tracing mode: the scene traced on, and where each edit goes. */
export interface Tracing {
  readonly scene: Scene;
  /** Pixels a click snaps within; 12 without. */
  readonly reach?: number;
  /** The picked line: a tap on a line picks it, a tap elsewhere drops it. */
  readonly line?: LineRef | undefined;
  readonly onpickline?: ((line: LineRef | undefined) => void) | undefined;
  /** A ready shape the next tap places, instead of tracing; reported as a `roof` or `dormer` edit,
   * after which the consumer lets go of it. */
  readonly placing?: Placing | undefined;
  /** The roof the lines go into, wherever they touch another: traced block `into`, or a new block
   * for `"new"` (a roof at another height beside one, ADR 20 "One roof, one block"); without, a
   * line goes into the roof it touches. */
  readonly into?: number | "new" | undefined;
  /** Each edit's next scene, and the edit: one undo step each. */
  readonly ontrace: (scene: Scene, edit: TraceEdit) => void;
}

/** What the tracing shows beside the scene. */
export interface Shown {
  /** What the pointer snaps to. */
  readonly snap: Snap | undefined;
  /** The chain's last point, which the line being drawn starts from. */
  readonly from: Spot | undefined;
  /** A dragged line where it would move to. */
  readonly dragged: { readonly from: Spot; readonly to: Spot } | undefined;
  /** The pointer on the canvas, in pixels. */
  readonly pointer: readonly [number, number] | undefined;
  /** Why the last click drew nothing, until the next. */
  readonly refused: Refusal | undefined;
  /** The direction the line being drawn is snapped to, through its corner, and its angle in
   * degrees. */
  readonly guide: Guide | undefined;
}
