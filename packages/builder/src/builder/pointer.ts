// A canvas's pointer listeners for a gesture: press, move, and release or cancel.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */

export interface Gesture {
  readonly press: (event: PointerEvent) => void;
  readonly move: (event: PointerEvent) => void;
  readonly release: (event: PointerEvent) => void;
}

/** Listens on `canvas`, in the order of the listeners added before; returns the removal. */
export function listen(canvas: HTMLCanvasElement, { press, move, release }: Gesture): () => void {
  const listeners = [
    ["pointerdown", press],
    ["pointermove", move],
    ["pointerup", release],
    ["pointercancel", release],
  ] as const;

  for (const [type, listener] of listeners) canvas.addEventListener(type, listener);

  return () => {
    for (const [type, listener] of listeners) canvas.removeEventListener(type, listener);
  };
}

/** Where `event` lands on `canvas`: −1 to 1 across, y up. */
export function ndc(canvas: HTMLCanvasElement, event: MouseEvent): [number, number] {
  const box = canvas.getBoundingClientRect();

  return [
    ((event.clientX - box.left) / box.width) * 2 - 1,
    1 - ((event.clientY - box.top) / box.height) * 2,
  ];
}

/** A first finger's press, given again to the orbit controls once a second finger comes, so both
 * pan and zoom; the gesture that held it lets that press pass. */
export class Handover {
  #handed: PointerEvent | undefined;

  /** Whether `event` is the press given again. */
  handed(event: PointerEvent): boolean {
    return event === this.#handed;
  }

  /** Presses finger `pointer` again on `canvas` where it is now. */
  give(canvas: HTMLCanvasElement, pointer: number, [clientX, clientY]: readonly [number, number]) {
    this.#handed = new PointerEvent("pointerdown", {
      pointerId: pointer,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY,
    });
    canvas.dispatchEvent(this.#handed);
    this.#handed = undefined;
  }
}
