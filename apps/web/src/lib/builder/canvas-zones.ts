// The canvas's fixed zones (ADR 20), measured: whatever lies over the scene marks itself with
// `data-canvas-zone`, and what must stay clear of the zones asks here where they are.
import type { Box, Room } from "./toolbar-place.ts";

/** The canvas in its own pixels above the `clear` a peeking sheet covers, and its zones' boxes. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element, only read.
export function measured(canvas: HTMLElement, clear: number): Room {
  const frame = canvas.getBoundingClientRect();

  const avoid = [...canvas.querySelectorAll("[data-canvas-zone]")].map((zone): Box => {
    const { left, top, right, bottom } = zone.getBoundingClientRect();

    return {
      left: left - frame.left,
      top: top - frame.top,
      right: right - frame.left,
      bottom: bottom - frame.top,
    };
  });

  return {
    bounds: { left: 0, top: 0, right: frame.width, bottom: frame.height - clear },
    // A zone not laid out, as a hidden status line, takes no room.
    avoid: avoid.filter((zone) => zone.right > zone.left && zone.bottom > zone.top),
  };
}
