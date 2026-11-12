// A horizontal swipe steps the range (ADR 21). Vertical movement stays the page's scroll,
// and a swipe that starts on a chart (`data-scrub`) reads the chart instead.
import type { Attachment } from "svelte/attachments";

export function swipe(onstep: (dir: -1 | 1) => void): Attachment<HTMLElement> {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it sets the node's touch action.
  return (node) => {
    let [id, t, x, y] = [-1, 0, 0, 0];

    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it reads the event's target.
    const down = (e: PointerEvent) => {
      const onChart = e.target instanceof Element && e.target.closest("[data-scrub]") !== null;

      if (e.pointerType === "mouse" || onChart) return;

      [x, y, t, id] = [e.clientX, e.clientY, e.timeStamp, e.pointerId];
    };

    const up = (
      e: Readonly<Pick<PointerEvent, "clientX" | "clientY" | "pointerId" | "timeStamp">>,
    ) => {
      if (e.pointerId !== id) return;

      id = -1;

      const dx = e.clientX - x;

      // Swiping right brings the earlier period in, as a page would.
      if (Math.abs(dx) > 48 && Math.abs(e.clientY - y) < 36 && e.timeStamp - t < 600) {
        onstep(dx > 0 ? -1 : 1);
      }
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
