// Tracing a roof on the canvas (ADR 20): seen from above, each click joins the last and snaps to
// the points and lines already traced, the snap named and the length of the line being drawn
// beside the pointer. A press on a traced line drags it; let go, it moves. The scene's operations
// are @sunreye/scene's; the canvas hands each next scene to its consumer. The pointer is
// trace-press.ts's.
import {
  addLine,
  moveLine,
  replay,
  type DormerSize,
  type End,
  type PointRef,
  type Refusal,
  type RoofSize,
  type Snap,
  type Spot,
  type TraceEdit,
} from "@sunreye/scene";
import { haptics } from "@sunreye/ui/haptics";
import { clickAt, type Aimed } from "./trace-aim.ts";
import type { Scene } from "./pv.ts";
import { faceUnder } from "./trace-place.ts";
import { ended, samePoint, shifted, snapOf, spotOf } from "./trace-ends.ts";

/** A traced line, by its block and its place in the block's lines. */
export interface LineRef {
  readonly block: number;
  readonly line: number;
}

/** An edit the tracing made, named with its operation's arguments, as the consumer may replay it
 * where it keeps the scene (`@sunreye/scene`'s `replay`). */
export type { TraceEdit };

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
}

/** Metres an end already picked by its pixels is snapped within again: none to speak of. */
const RESOLVED = 1e-3;

/** A press: where it landed, and the traced line it took, which a drag moves. */
interface Pressed {
  readonly at: Spot;
  readonly line: LineRef | undefined;
}

export class TraceTool {
  #from = $state.raw<End>();
  #start = $state.raw<PointRef>();
  #snap = $state.raw<Snap>();
  #pointer = $state.raw<readonly [number, number]>();
  #dragged = $state.raw<Shown["dragged"]>();
  #refused = $state.raw<Refusal>();
  #scene = $state.raw<Scene>();
  #pressed: Pressed | undefined;
  /** The block this chain's first line made, traced into a new roof: its later lines join it. */
  #made: number | undefined;

  readonly shown: Shown = $derived({
    snap: this.#snap,
    from: this.#fromSpot,
    dragged: this.#dragged,
    pointer: this.#pointer,
    refused: this.#refused,
  });

  get #fromSpot(): Spot | undefined {
    const [from, scene] = [this.#from, this.#scene];

    if (from === undefined || scene === undefined) return undefined;

    return "point" in from ? spotOf(scene, from) : [from.x, from.height ?? 0, from.z];
  }

  /** Ends the chain: the next click starts another. */
  end(): void {
    this.#from = undefined;
    this.#start = undefined;
    this.#made = undefined;
  }

  /** The pointer on the canvas, in pixels; off it, nothing snaps. */
  point(at?: readonly [number, number]): void {
    this.#pointer = at;

    if (at === undefined) this.#snap = undefined;
  }

  press(tracing: Tracing, aimed: Aimed): void {
    const snapped = snapOf(tracing.scene, aimed);
    const { at } = aimed;

    const line =
      this.#from === undefined && snapped.kind === "line"
        ? { block: snapped.block, line: snapped.line }
        : undefined;

    this.#scene = tracing.scene;
    this.#pressed = { at, line };
  }

  /** The pointer moved: its snap, and a dragged line where it would go. */
  move(tracing: Tracing, aimed: Aimed, dragged: boolean): void {
    const pressed = this.#pressed;
    const line = pressed?.line;
    const { at } = aimed;

    this.#scene = tracing.scene;
    this.#snap = line === undefined ? snapOf(tracing.scene, aimed) : undefined;

    if (dragged && line !== undefined && pressed !== undefined)
      this.#dragged = shifted(tracing.scene, line, pressed.at, at);
  }

  /** A press put back: nothing happens. */
  abort(): void {
    this.#pressed = undefined;
    this.#dragged = undefined;
  }

  /** Let go: a dragged line moves; a tap, or a finger's drag, clicks. */
  release(tracing: Tracing, aimed: Aimed, dragged: boolean, finger: boolean): void {
    const pressed = this.#pressed;

    this.abort();

    if (pressed === undefined) return;

    if (dragged && pressed.line !== undefined) this.#moved(tracing, pressed, aimed.at);
    else if (!dragged || finger) this.#clicked(tracing, aimed, pressed.line);
  }

  #answered(refused?: Refusal): void {
    this.#refused = refused;

    if (refused === undefined) haptics.selection();
    else haptics.error();
  }

  /** A dragged line let go: it moves, unless lines would cross. */
  #moved(tracing: Tracing, { line, at }: Pressed, to: Spot): void {
    if (line === undefined) return;

    const by = { x: to[0] - at[0], z: to[2] - at[2] };
    const edited = moveLine(tracing.scene, line.block, line.line, by);

    if ("refused" in edited) {
      this.#answered(edited.refused);

      return;
    }

    this.#answered();
    tracing.ontrace(edited.scene, { kind: "move", ...line, by });
  }

  /** A tap with a ready shape held: it is placed there, a roof centred on the ground under it, a
   * dormer on the face drawn under it. */
  #placed(tracing: Tracing, placing: Placing, aimed: Aimed): void {
    const { scene } = tracing;
    const { x, z } = clickAt(aimed.at);
    const face = placing.kind === "dormer" ? faceUnder(scene, { x, z }, aimed.ray) : undefined;

    this.end();

    const edit: TraceEdit | undefined =
      placing.kind === "roof"
        ? {
            ...placing,
            at: { x: x - placing.size.width / 2, z: z - placing.size.depth / 2 },
          }
        : face && { ...placing, ...face };

    const edited = edit === undefined ? { refused: "missing" as const } : replay(scene, edit);

    this.#answered("refused" in edited ? edited.refused : undefined);

    if (edit !== undefined && !("refused" in edited)) tracing.ontrace(edited.scene, edit);
  }

  /** A click: with no chain, a tap on a line picks it and one elsewhere starts a chain; on the
   * chain's last point it ends the chain; anywhere else it draws the line to there. */
  #clicked(tracing: Tracing, aimed: Aimed, line: LineRef | undefined): void {
    const { reach } = aimed;
    const end = ended(tracing.scene, aimed);
    const from = this.#from;

    this.#refused = undefined;

    if (tracing.placing !== undefined) this.#placed(tracing, tracing.placing, aimed);
    else if (from === undefined) this.#started(tracing, end, line);
    else if (samePoint(from, end)) this.end();
    // Ends picked by pixels are resolved already: the scene's snap in metres must not move them.
    else this.#joined(tracing, from, end, aimed.snap === undefined ? reach : RESOLVED);
  }

  /** No chain yet: a tap on a line picks it, one elsewhere starts a chain there. */
  #started(tracing: Tracing, end: End, line: LineRef | undefined): void {
    tracing.onpickline?.(line);

    if (line !== undefined) return;

    this.#from = end;
    this.#start = "point" in end ? end : undefined;
  }

  /** The chain after a line from `edited.from` to `edited.to`: back on its first point it closes
   * its loop and ends; one begun on another roof's point, drawn into a new one, closes on its own
   * point there. */
  #chain(
    edited: { readonly block: number; readonly from: number; readonly to: number },
    into: number | "new" | undefined,
  ): void {
    const { block, from, to } = edited;
    const start = this.#start?.block === block ? this.#start : { block, point: from };
    const closes = start.point === to;

    this.#made = !closes && into === "new" ? block : closes ? undefined : this.#made;
    this.#start = closes ? undefined : start;
    this.#from = closes ? undefined : { block, point: to };
  }

  /** The line from the chain's last point to `end`; back on the chain's first point it closes its
   * loop and ends the chain. */
  #joined(tracing: Tracing, from: End, end: End, reach: number): void {
    const into = tracing.into === "new" ? (this.#made ?? "new") : tracing.into;
    const edited = addLine(tracing.scene, from, end, reach, into);

    if ("refused" in edited) {
      this.#answered(edited.refused);

      return;
    }

    this.#answered();

    this.#chain(edited, into);
    this.#scene = edited.scene;
    tracing.ontrace(edited.scene, {
      kind: "add",
      from,
      to: end,
      reach,
      ...(into !== undefined && { into }),
    });
  }
}
