// A finger resting on a chart inside a sheet (ADR 21 "Sheet content"): it reads once held, so the
// drawer does not follow it; one that wanders first is scrolling. A drawer leaves the finger alone
// while it rests or reads: vaul keeps a finger it took once, so the mark comes at touch-down, not
// with the reading.

/** How long a finger rests before it reads, in ms. */
const HOLD_MS = 250;

/** How far a resting finger may wander, in px. */
const SLACK = 8;

/** What a vaul drawer does not drag by. */
const NO_DRAG = "data-vaul-no-drag";

/** What a resting finger is told of a pointer event. */
export type Touch = Readonly<Pick<PointerEvent, "clientX" | "clientY">> & {
  readonly currentTarget: Element;
};

export class Rest<P> {
  #at: { readonly x: number; readonly y: number; readonly p: P; readonly timer: number } | null =
    null;

  /** The finger held and reads. */
  reading = false;

  /** What the finger rests or reads on, marked so the drawer leaves it alone. */
  #marked: Element | undefined;

  /** A finger goes down on `p`; held, `onheld` reads it. */
  down(e: Touch, p: P, onheld: (p: P) => void): void {
    this.drop();

    this.#marked = e.currentTarget;
    this.#marked.setAttribute(NO_DRAG, "");

    const timer = window.setTimeout(() => {
      this.reading = true;
      onheld(p);
    }, HOLD_MS);

    this.#at = { x: e.clientX, y: e.clientY, p, timer };
  }

  /** A finger not yet reading that wanders is scrolling: it lets go. */
  move(e: Touch): void {
    const at = this.#at;

    if (!this.reading && at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > SLACK) this.drop();
  }

  /** The place a finger lifted before it held tapped; null if it read or wandered off. */
  get tapped(): P | null {
    return this.reading ? null : (this.#at?.p ?? null);
  }

  drop(): void {
    if (this.#at) clearTimeout(this.#at.timer);

    this.#at = null;
    this.reading = false;
    this.#marked?.removeAttribute(NO_DRAG);
    this.#marked = undefined;
  }
}
