// Undo and redo of the builder's edits until save (ADR 20).

/** Every state the admin can step back or forward to. */
export interface Edits<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export function begin<T>(present: T): Edits<T> {
  return { past: [], present, future: [] };
}

/** `next` as the present; what was undone is gone. */
export function record<T>(history: Edits<T>, next: T): Edits<T> {
  return { past: [...history.past, history.present], present: next, future: [] };
}

export function undo<T>(history: Edits<T>): Edits<T> {
  const previous = history.past.at(-1);

  if (previous === undefined) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: Edits<T>): Edits<T> {
  const [next, ...future] = history.future;

  if (next === undefined) return history;

  return { past: [...history.past, history.present], present: next, future };
}
