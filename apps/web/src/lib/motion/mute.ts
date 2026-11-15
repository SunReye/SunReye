// What leaves takes no more presses (ADR 21). Not by `inert`: that restyles the whole subtree in
// the frame of the change that made it leave.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */

const PRESSES = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "keydown"] as const;

function swallow(event: Event): void {
  event.stopPropagation();
  event.preventDefault();
}

/** `node` and all in it take no presses until the returned undo; as an attachment, while attached. */
export function mute(node: Element): () => void {
  for (const type of PRESSES) node.addEventListener(type, swallow, { capture: true });

  return () => {
    for (const type of PRESSES) node.removeEventListener(type, swallow, { capture: true });
  };
}
