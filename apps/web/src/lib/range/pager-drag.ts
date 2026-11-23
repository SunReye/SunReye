// The one swipe of the range (ADR 21): a finger dragging a pager, where horizontal movement past
// 10 px is the pager's, vertical stays the page's scroll, and a drag that starts on a chart
// (`data-scrub`) reads the chart. On the still tier, or for a swipe that only steps, nothing moves.
import type { Attachment } from "svelte/attachments";
import { VelocityTracker } from "@sunreye/builder/animate.ts";

export interface DragHandlers {
  /** Whether a drag can page at all. */
  readonly enabled: () => boolean;
  readonly still: () => boolean;
  /** The drag is the pager's: it returns the track's offset now, in px. */
  readonly start: () => number;
  /** The offset the finger asks for. */
  readonly move: (want: number) => void;
  /** px per second; cancelled when the browser took the pointer. */
  readonly release: (velocity: number, cancelled: boolean) => void;
  /** A swipe on the still tier. */
  readonly step: (dir: -1 | 1) => void;
}

type At = Readonly<Pick<PointerEvent, "clientX" | "clientY" | "pointerId">>;

const SLOP = 10;

class Gesture {
  readonly #h: DragHandlers;
  readonly #claim: (pointer: number) => void;
  readonly #speed = new VelocityTracker();
  #pid = -1;
  #from = { x: 0, y: 0 };
  #x0 = 0;
  #dx0 = 0;
  /** 0 undecided, 1 ours, -1 the page's scroll. */
  #mine = 0;

  constructor(h: DragHandlers, claim: (pointer: number) => void) {
    [this.#h, this.#claim] = [h, claim];
  }

  down(e: At & Readonly<{ pointerType: string; onChart: boolean }>): void {
    if (e.pointerType === "mouse" || !this.#h.enabled() || e.onChart) return;

    [this.#pid, this.#from, this.#mine] = [e.pointerId, { x: e.clientX, y: e.clientY }, 0];
    this.#speed.reset();
  }

  /** Decides whose the gesture is, once it has moved past the slop. */
  #decide(dx: number, dy: number): void {
    if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) this.#mine = -1;

    if (this.#mine < 0 || Math.abs(dx) < SLOP || this.#h.still()) return;

    this.#mine = 1;
    [this.#x0, this.#dx0] = [this.#h.start(), dx];
    this.#claim(this.#pid);
  }

  move(e: At): void {
    if (e.pointerId !== this.#pid || this.#mine < 0) return;

    const [dx, dy] = [e.clientX - this.#from.x, e.clientY - this.#from.y];

    if (this.#mine === 0) this.#decide(dx, dy);

    if (this.#mine !== 1) return;

    this.#h.move(this.#x0 + (dx - this.#dx0));
    this.#speed.push(e.clientX);
  }

  up(e: At & Readonly<{ cancelled: boolean }>): void {
    if (e.pointerId !== this.#pid) return;

    this.#pid = -1;

    const dx = e.clientX - this.#from.x;

    if (this.#mine === 1) {
      this.#h.release(e.cancelled ? 0 : this.#speed.velocity(), e.cancelled);

      return;
    }

    // Still tier: no travel, the swipe just steps; swiping right brings the earlier period in.
    const flat = Math.abs(e.clientY - this.#from.y) < 36;

    if (this.#h.still() && this.#mine === 0 && Math.abs(dx) > 48 && flat)
      this.#h.step(dx > 0 ? -1 : 1);
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it sets the node's touch action.
export function drag(node: HTMLElement, h: DragHandlers): () => void {
  const g = new Gesture(h, (pointer) => {
    try {
      node.setPointerCapture(pointer);
    } catch {
      // A pointer already gone cannot be captured; the drag still follows its moves.
    }
  });

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it reads the event's target.
  const down = (e: PointerEvent) => {
    const onChart = e.target instanceof Element && e.target.closest("[data-scrub]") !== null;

    g.down({ ...pick(e), pointerType: e.pointerType, onChart });
  };

  const move = (e: At) => {
    g.move(pick(e));
  };

  const up = (e: At & Readonly<{ type: string }>) => {
    g.up({ ...pick(e), cancelled: e.type === "pointercancel" });
  };

  node.style.touchAction = "pan-y";
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", up);

  return () => {
    node.removeEventListener("pointerdown", down);
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerup", up);
    node.removeEventListener("pointercancel", up);
  };
}

const pick = (e: At): At => ({ clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId });

/** A swipe that only steps, as on a stepper's label: nothing moves. */
export function swipe(onstep: (dir: -1 | 1) => void): Attachment<HTMLElement> {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it sets the node's touch action.
  return (node) =>
    drag(node, {
      enabled: () => true,
      still: () => true,
      start: () => 0,
      move: () => {},
      release: () => {},
      step: onstep,
    });
}
