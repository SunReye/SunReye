// Tracing a roof on the canvas (ADR 20): seen from above, each click joins the last and snaps to
// the points and lines already traced, the snap named and the length of the line being drawn
// beside the pointer. A press on a traced line drags it; let go, it moves. The scene's operations
// are @sunreye/scene's; the canvas hands each next scene to its consumer. The pointer is
// trace-press.ts's.
import {
  addLine,
  type End,
  type PointRef,
  type Refusal,
  type Snap,
  type Spot,
} from "@sunreye/scene";
import { haptics } from "@sunreye/ui/haptics";
import type { Plan } from "./plan.ts";
import { direction, turned, type Guide } from "./trace-angle.ts";
import type { Aimed } from "./trace-aim.ts";
import type { Scene } from "./pv.ts";
import { ended, samePoint, snapOf, spotOf } from "./trace-ends.ts";
import {
  lineDragged,
  lineMoved,
  lineSplit,
  pointLines,
  pointMoved,
  pointRemoved,
  readyPlaced,
  type Made,
} from "./trace-points.ts";
import type { LineRef, Shown, Tracing } from "./trace-types.ts";

export type { LineRef, Placing, Shown, Tracing } from "./trace-types.ts";

/** What a pointer snaps to, and the guide of the direction it was turned onto. */
type Snapped = Readonly<{ snap: Snap; guide: Guide | undefined }>;

/** Metres an end already picked by its pixels is snapped within again: none to speak of. */
const RESOLVED = 1e-3;

/** A press: where it landed, and the traced line or point it took, which a drag moves. */
interface Pressed {
  readonly at: Spot;
  readonly line: LineRef | undefined;
  readonly point: PointRef | undefined;
}

export class TraceTool {
  #from = $state.raw<End>();
  #start = $state.raw<PointRef>();
  #snap = $state.raw<Snap>();
  #pointer = $state.raw<readonly [number, number]>();
  #dragged = $state.raw<Shown["dragged"]>();
  #refused = $state.raw<Refusal>();
  #scene = $state.raw<Scene>();
  #guide = $state.raw<Guide>();
  /** The chain's first line and its last, as directions, which the next line is snapped by. */
  #first: Plan | undefined;
  #previous: Plan | undefined;
  #pressed: Pressed | undefined;
  /** The block this chain's first line made, traced into a new roof: its later lines join it. */
  #made: number | undefined;

  readonly shown: Shown = $derived({
    snap: this.#snap,
    from: this.#fromSpot,
    dragged: this.#dragged,
    pointer: this.#pointer,
    refused: this.#refused,
    guide: this.#guide,
  });

  /** A traced point or line under the pointer, with no line being drawn: it would be grabbed. */
  get grabbing(): boolean {
    return this.#from === undefined && this.#snap !== undefined && this.#snap.kind !== "free";
  }

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
    this.#first = undefined;
    this.#previous = undefined;
    this.#guide = undefined;
  }

  /** What `aimed` snaps to: a traced point or line, else, drawing on from a corner and not
   * `free`, a direction the line nearly takes (angle-snap.ts); with the guide it took. */
  #snapped(scene: Scene, aimed: Aimed): Snapped {
    const snapped = snapOf(scene, aimed);
    const from = this.#fromSpot;

    if (snapped.kind !== "free" || from === undefined || aimed.free === true)
      return { snap: snapped, guide: undefined };

    const angled = turned(scene, aimed, from, { previous: this.#previous, first: this.#first });

    return angled === undefined
      ? { snap: snapped, guide: undefined }
      : { snap: { kind: "free", at: angled.at }, guide: angled.guide };
  }

  /** The pointer on the canvas, in pixels; off it, nothing snaps. */
  point(at?: readonly [number, number]): void {
    this.#pointer = at;

    if (at === undefined) this.#snap = undefined;
  }

  press(tracing: Tracing, aimed: Aimed): void {
    const snapped = snapOf(tracing.scene, aimed);
    const { at } = aimed;

    const idle = this.#from === undefined && tracing.placing === undefined;

    const line =
      idle && snapped.kind === "line" ? { block: snapped.block, line: snapped.line } : undefined;

    const point =
      idle && snapped.kind === "point" ? { block: snapped.block, point: snapped.point } : undefined;

    this.#scene = tracing.scene;
    this.#pressed = { at, line, point };
  }

  /** The pointer moved: its snap, and a dragged line where it would go. */
  move(tracing: Tracing, aimed: Aimed, dragged: boolean): void {
    const pressed = this.#pressed;
    const line = pressed?.line;
    const { at } = aimed;

    this.#scene = tracing.scene;
    const snapped = line === undefined ? this.#snapped(tracing.scene, aimed) : undefined;

    this.#snap = snapped?.snap;
    this.#guide = snapped?.guide;

    if (!dragged || pressed === undefined) return;

    if (line !== undefined) this.#dragged = lineDragged(tracing.scene, line, pressed.at, at);
    else if (pressed.point !== undefined && snapped !== undefined)
      this.#dragged = pointLines(tracing.scene, pressed.point, snapped.snap.at);
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

    if (dragged && pressed.line !== undefined)
      this.#apply(tracing, lineMoved(tracing.scene, pressed.line, pressed.at, aimed.at));
    else if (dragged && pressed.point !== undefined && !finger) {
      const to = this.#snapped(tracing.scene, aimed).snap.at;

      this.#apply(tracing, pointMoved(tracing.scene, pressed.point, to));
    } else if (!dragged || finger) this.#clicked(tracing, aimed, pressed.line);
  }

  /** A double click: on a traced line, with no chain, a point is put into it there. */
  split(tracing: Tracing, aimed: Aimed): void {
    const snapped = snapOf(tracing.scene, aimed);

    if (this.#from !== undefined || snapped.kind !== "line") return;

    this.#apply(tracing, lineSplit(tracing.scene, snapped, aimed.at));
  }

  /** Del: the point tapped, before a line is drawn from it, is taken out. */
  removeTapped(tracing: Tracing): void {
    const start = this.#start;

    if (start === undefined || this.#from === undefined || !samePoint(this.#from, start)) return;

    this.end();
    this.#apply(tracing, pointRemoved(tracing.scene, start));
  }

  /** An edit made: its scene handed on, or why not said. */
  #apply(tracing: Tracing, { edited, edit }: Readonly<Made>): void {
    this.#answered("refused" in edited ? edited.refused : undefined);

    if ("refused" in edited || edit === undefined) return;

    this.#scene = edited.scene;
    tracing.ontrace(edited.scene, edit);
  }

  #answered(refused?: Refusal): void {
    this.#refused = refused;

    if (refused === undefined) haptics.selection();
    else haptics.error();
  }

  /** A click: with no chain, a tap on a line picks it and one elsewhere starts a chain; on the
   * chain's last point it ends the chain; anywhere else it draws the line to there. */
  #clicked(tracing: Tracing, aimed: Aimed, line: LineRef | undefined): void {
    const { reach } = aimed;
    const end = ended(this.#snapped(tracing.scene, aimed), aimed);
    const from = this.#from;

    this.#refused = undefined;

    if (tracing.placing !== undefined) {
      this.end();
      this.#apply(tracing, readyPlaced(tracing.scene, tracing.placing, aimed));
    } else if (from === undefined) this.#started(tracing, end, line);
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
    this.#first = undefined;
    this.#previous = undefined;
  }

  /** The chain after a line from `edited.from` to `edited.to`: back on its first point it closes
   * its loop and ends; one begun on another roof's point, drawn into a new one, closes on its own
   * point there. */
  #chain(
    edited: Readonly<{ block: number; from: number; to: number; scene: Scene }>,
    into: number | "new" | undefined,
  ): void {
    const { block, from, to } = edited;
    const start = this.#start?.block === block ? this.#start : { block, point: from };
    const closes = start.point === to;

    this.#made = !closes && into === "new" ? block : closes ? undefined : this.#made;
    this.#start = closes ? undefined : start;
    this.#from = closes ? undefined : { block, point: to };
    this.#bearings(edited, closes);
  }

  /** The chain's first line and its last after line `edited`, which snap the next; none once
   * it closes. */
  #bearings(
    edited: Readonly<{ block: number; from: number; to: number; scene: Scene }>,
    closes: boolean,
  ): void {
    const { block, from, to, scene } = edited;

    const line = direction(
      spotOf(scene, { block, point: from }),
      spotOf(scene, { block, point: to }),
    );

    this.#first = closes ? undefined : (this.#first ?? line);
    this.#previous = closes ? undefined : line;
    this.#guide = undefined;
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
