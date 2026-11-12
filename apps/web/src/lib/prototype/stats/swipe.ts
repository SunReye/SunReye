// PROTOTYPE: a horizontal swipe steps the range (ADR 21). Vertical movement stays the page's scroll,
// and a swipe that starts on a chart (`data-scrub`) reads the chart instead.
import type { Attachment } from "svelte/attachments";

export function swipe(onstep: (dir: -1 | 1) => void): Attachment<HTMLElement> {
  return (node) => {
    let x = 0, y = 0, t = 0, id = -1;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || (e.target as Element).closest("[data-scrub]")) return;
      [x, y, t, id] = [e.clientX, e.clientY, e.timeStamp, e.pointerId];
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      const dx = e.clientX - x;
      // Swiping right brings the earlier period in, as a page would.
      if (Math.abs(dx) > 48 && Math.abs(e.clientY - y) < 36 && e.timeStamp - t < 600) onstep(dx > 0 ? -1 : 1);
    };
    node.style.touchAction = "pan-y";
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointerup", up);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointerup", up);
    };
  };
}
