// Reading a detail's charts by the day (ADR 21 "Chart reading", ADR 23 "Dashboard"): which of
// the day's slots is under the pointer. A mouse reads where it hovers. A finger reads once it is
// held, then leads; one that moves first scrolls the sheet, and one lifted before it held taps.

/** What a handler reads of a pointer event. */
type Pointer = Readonly<Pick<PointerEvent, "clientX" | "clientY" | "pointerType">> & {
  readonly currentTarget: Element;
};

/** How long a finger rests before it reads, in ms. */
const HOLD_MS = 250;

/** How far a resting finger may wander, in px. */
const SLACK = 8;

export class PointerReading {
  readonly #slots: () => number;
  readonly #read: () => number | null;
  readonly #write: (at: number | null) => void;
  readonly #tap: ((at: number) => void) | undefined;
  #held:
    | { readonly x: number; readonly y: number; readonly slot: number; readonly timer: number }
    | undefined;

  /**
   * @param slots how many equal slots the day is read in, such as its hours, at an input
   * @param read the index of the slot being read, null with none: the caller's state
   * @param write sets it
   * @param tap a finger lifted from a slot before it held, as on a bar that opens
   */
  constructor(
    slots: () => number,
    read: () => number | null,
    write: (at: number | null) => void,
    tap?: (at: number) => void,
  ) {
    this.#slots = slots;
    this.#read = read;
    this.#write = write;
    this.#tap = tap;
  }

  /** The index of the slot being read; null with none. */
  get at(): number | null {
    return this.#read();
  }

  set at(at: number | null) {
    this.#write(at);
  }

  #over(e: Pointer): number {
    const box = e.currentTarget.getBoundingClientRect();
    const slots = this.#slots();
    const slot = Math.floor(((e.clientX - box.left) / box.width) * slots);

    return Math.min(slots - 1, Math.max(0, slot));
  }

  #drop(): void {
    clearTimeout(this.#held?.timer);
    this.#held = undefined;
  }

  down = (e: Pointer): void => {
    if (e.pointerType === "mouse") return;

    this.#drop();

    const slot = this.#over(e);

    const timer = window.setTimeout(() => {
      this.at = slot;
    }, HOLD_MS);

    this.#held = { x: e.clientX, y: e.clientY, slot, timer };
  };

  move = (e: Pointer): void => {
    if (e.pointerType === "mouse" || this.at !== null) this.at = this.#over(e);
    else if (this.#held && Math.hypot(e.clientX - this.#held.x, e.clientY - this.#held.y) > SLACK)
      this.#drop();
  };

  /** A lifted finger ends its reading, or taps; a mouse reads on through a click. */
  up = (e: Pointer): void => {
    if (e.pointerType === "mouse") return;

    const tapped = this.at === null ? this.#held?.slot : undefined;

    this.end();

    if (tapped !== undefined) this.#tap?.(tapped);
  };

  /** The pointer left, or the finger began to scroll. */
  end = (): void => {
    this.#drop();
    this.at = null;
  };
}
