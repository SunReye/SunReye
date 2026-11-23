// Tracing a roof on the canvas (ADR 20): seen from above, each click joins the last and snaps to
// the points and lines already traced, the snap named and the length of the line being drawn
// beside the pointer. A press on a traced line drags it; let go, it moves. The scene's operations
// are @sunreye/scene's; the canvas hands each next scene to its consumer. The pointer is
// trace-press.ts's.
import {
  addLine,
  moveLine,
  snap,
  type Click,
  type End,
  type PointRef,
  type Refusal,
  type Snap,
  type Spot,
} from "@sunreye/scene";
import { haptics } from "@sunreye/ui/haptics";
import { clickAt, type Aimed } from "./trace-aim.ts";
import type { Scene } from "./pv.ts";

/** A traced line, by its block and its place in the block's lines. */
export interface LineRef {
  readonly block: number;
  readonly line: number;
}

/** An edit the tracing made, as the consumer may run it again where it keeps the scene. */
export type TraceEdit =
  | { readonly kind: "add"; readonly from: End; readonly to: End }
  | {
      readonly kind: "move";
      readonly block: number;
      readonly line: number;
      readonly by: { readonly x: number; readonly z: number };
    };

/** The tracing mode: the scene traced on, and where each edit goes. */
export interface Tracing {
  readonly scene: Scene;
  /** Pixels a click snaps within; 12 without. */
  readonly reach?: number;
  /** The height of what is traced on under a place seen from above, when it carries heights: a
   * click there lands at it and sets its point's height. */
  readonly height?: ((x: number, z: number) => number | undefined) | undefined;
  /** The picked line: a tap on a line picks it, a tap elsewhere drops it. */
  readonly line?: LineRef | undefined;
  readonly onpickline?: ((line: LineRef | undefined) => void) | undefined;
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

/** A press: where it landed, and the traced line it took, which a drag moves. */
interface Pressed {
  readonly at: Spot;
  readonly line: LineRef | undefined;
}

/** A traced point's spot. */
function spotOf(scene: Scene, { block, point }: PointRef): Spot {
  const [x = 0, y = 0, z = 0] = scene.blocks[block]?.freeForm?.traced?.points[point] ?? [];

  return [x, y, z];
}

/** Line `line` shifted level by the move from `from` to `to`. */
function shifted(scene: Scene, { block, line }: LineRef, from: Spot, to: Spot): Shown["dragged"] {
  const [a = 0, b = 0] = scene.blocks[block]?.freeForm?.traced?.lines[line] ?? [];

  const by = (point: number): Spot => {
    const [x, y, z] = spotOf(scene, { block, point });

    return [x + to[0] - from[0], y, z + to[2] - from[2]];
  };

  return { from: by(a), to: by(b) };
}

/** Where a click ends a line: the traced point it snaps to, else the click itself. */
function ended(scene: Scene, click: Click, reach: number): End {
  const snapped = snap(scene, click, reach);

  return snapped.kind === "point" ? { block: snapped.block, point: snapped.point } : click;
}

/** Whether two ends are the same traced point. */
const samePoint = (a: End, b: End): boolean =>
  "point" in a && "point" in b && a.block === b.block && a.point === b.point;

export class TraceTool {
  #from = $state.raw<End>();
  #start = $state.raw<PointRef>();
  #snap = $state.raw<Snap>();
  #pointer = $state.raw<readonly [number, number]>();
  #dragged = $state.raw<Shown["dragged"]>();
  #refused = $state.raw<Refusal>();
  #scene = $state.raw<Scene>();
  #pressed: Pressed | undefined;

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
  }

  /** The pointer on the canvas, in pixels; off it, nothing snaps. */
  point(at?: readonly [number, number]): void {
    this.#pointer = at;

    if (at === undefined) this.#snap = undefined;
  }

  press(tracing: Tracing, { at, reach }: Aimed): void {
    const snapped = snap(tracing.scene, clickAt(at), reach);

    const line =
      this.#from === undefined && snapped.kind === "line"
        ? { block: snapped.block, line: snapped.line }
        : undefined;

    this.#scene = tracing.scene;
    this.#pressed = { at, line };
  }

  /** The pointer moved: its snap, and a dragged line where it would go. */
  move(tracing: Tracing, { at, reach }: Aimed, dragged: boolean): void {
    const pressed = this.#pressed;
    const line = pressed?.line;

    this.#scene = tracing.scene;
    this.#snap = line === undefined ? snap(tracing.scene, clickAt(at), reach) : undefined;

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

  /** A click: with no chain, a tap on a line picks it and one elsewhere starts a chain; on the
   * chain's last point it ends the chain; anywhere else it draws the line to there. */
  #clicked(tracing: Tracing, { at, reach }: Aimed, line: LineRef | undefined): void {
    const end = ended(tracing.scene, clickAt(at), reach);
    const from = this.#from;

    this.#refused = undefined;

    if (from === undefined) this.#started(tracing, end, line);
    else if (samePoint(from, end)) this.end();
    else this.#joined(tracing, from, end, reach);
  }

  /** No chain yet: a tap on a line picks it, one elsewhere starts a chain there. */
  #started(tracing: Tracing, end: End, line: LineRef | undefined): void {
    tracing.onpickline?.(line);

    if (line !== undefined) return;

    this.#from = end;
    this.#start = "point" in end ? end : undefined;
  }

  /** The line from the chain's last point to `end`; back on the chain's first point it closes its
   * loop and ends the chain. */
  #joined(tracing: Tracing, from: End, end: End, reach: number): void {
    const edited = addLine(tracing.scene, from, end, reach);

    if ("refused" in edited) {
      this.#answered(edited.refused);

      return;
    }

    this.#answered();

    const start = this.#start ?? { block: edited.block, point: edited.from };
    const closes = start.block === edited.block && start.point === edited.to;

    this.#start = closes ? undefined : start;
    this.#from = closes ? undefined : { block: edited.block, point: edited.to };
    this.#scene = edited.scene;
    tracing.ontrace(edited.scene, { kind: "add", from, to: end });
  }
}
