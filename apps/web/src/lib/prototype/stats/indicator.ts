// PROTOTYPE: kbase's sliding `active-indicator`, moved by `transform` alone (ADR 21): the registry's
// own slides `left` and `width`, which are layout. The node is a 100 px square at the list's origin;
// its transform puts it over the active item, and a CSS transition carries it between items, so a
// second click mid-slide continues from where it is.
import type { Attachment } from "svelte/attachments";
import { motion } from "../motion/tier.svelte";

/**
 * @param active selector of the active item inside the node's parent
 * @param line draw a line of this many px under the item instead of covering it
 */
export function indicator(active: string, line = 0): Attachment<HTMLElement> {
  return (node) => {
    const list = node.parentElement!;
    const glide = "transform var(--motion-move) var(--motion-ease-in-out), opacity 150ms var(--motion-ease)";
    Object.assign(node.style, { position: "absolute", left: "0", top: "0", width: "100px", height: "100px", transformOrigin: "0 0", pointerEvents: "none", opacity: "0", transition: glide });
    let placed = false;
    let seen: Element | null = null;
    const sizes = new ResizeObserver(() => place());

    function place(): void {
      const el = list.querySelector<HTMLElement>(active);
      if (el !== seen) {
        if (seen) sizes.unobserve(seen);
        if (el) sizes.observe(el);
        seen = el;
      }
      if (!el || !el.getClientRects().length) {
        node.style.opacity = "0";
        placed = false;
        return;
      }
      const a = list.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const [x, y, w, h] = [b.left - a.left - list.clientLeft, b.top - a.top - list.clientTop, b.width, b.height];
      // The first placement is not a movement, and on the still tier none is.
      const jump = !placed || motion.still;
      if (jump) node.style.transition = "none";
      node.style.transform = line ? `translate(${x}px, ${y + h - line}px) scale(${w / 100}, ${line / 100})` : `translate(${x}px, ${y}px) scale(${w / 100}, ${h / 100})`;
      node.style.opacity = "1";
      if (jump) {
        void node.offsetWidth;
        node.style.transition = glide;
      }
      placed = true;
    }

    const changes = new MutationObserver(place);
    changes.observe(list, { attributes: true, subtree: true, childList: true, attributeFilter: ["data-state", "aria-selected", "aria-checked", "aria-pressed"] });
    sizes.observe(list);
    place();
    return () => {
      changes.disconnect();
      sizes.disconnect();
    };
  };
}
