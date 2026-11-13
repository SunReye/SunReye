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
