// kbase's sliding `active-indicator`, moved by `transform` alone (ADR 21): the registry's
// own slides `left` and `width`, which are layout. The node is a 100 px square at the list's origin;
// its transform puts it over the active item, and a CSS transition carries it between items, so a
// second click mid-slide continues from where it is.
import type { Attachment } from "svelte/attachments";
import { motion } from "../motion/tier.svelte.ts";

const GLIDE =
  "transform var(--motion-move) var(--motion-ease-in-out), opacity var(--motion-fast) var(--motion-ease)";

const BOX = {
  position: "absolute",
  left: "0",
  top: "0",
  width: "100px",
  height: "100px",
  transformOrigin: "0 0",
  pointerEvents: "none",
  opacity: "0",
  transition: GLIDE,
};

/** The transform that puts the 100 px square over a w × h box at x, y, or a line under it. */
function over(x: number, y: number, w: number, h: number, line: number): string {
  return line
    ? `translate(${x}px, ${y + h - line}px) scale(${w / 100}, ${line / 100})`
    : `translate(${x}px, ${y}px) scale(${w / 100}, ${h / 100})`;
}

class Slide {
  readonly #node: HTMLElement;
  readonly #list: HTMLElement;
  readonly #active: string;
  readonly #line: number;
  readonly #sizes = new ResizeObserver(() => {
    this.place();
  });
  #placed = false;
  #seen: Element | null = null;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it moves the node.
  constructor(node: HTMLElement, active: string, line: number) {
    this.#node = node;
    this.#list = node.parentElement ?? node;
    this.#active = active;
    this.#line = line;
    Object.assign(node.style, BOX);
  }

  /** Watches the item for size changes while it is the active one. */
  #watch(item: Element | null): void {
    if (item === this.#seen) return;

    if (this.#seen) this.#sizes.unobserve(this.#seen);

    if (item) this.#sizes.observe(item);

    this.#seen = item;
  }

  place(): void {
    const item = this.#list.querySelector(this.#active);
    const style = this.#node.style;

    this.#watch(item);

    if (!item || item.getClientRects().length === 0) {
      style.opacity = "0";
      this.#placed = false;

      return;
    }

    // The first placement is not a movement, and on the still tier none is.
    const jump = !this.#placed || motion.still;

    if (jump) style.transition = "none";

    const [a, b, list] = [
      this.#list.getBoundingClientRect(),
      item.getBoundingClientRect(),
      this.#list,
    ];

    style.transform = over(
      b.left - a.left - list.clientLeft,
      b.top - a.top - list.clientTop,
      b.width,
      b.height,
      this.#line,
    );
    style.opacity = "1";

    if (jump) {
      void this.#node.offsetWidth;
      style.transition = GLIDE;
    }

    this.#placed = true;
  }

  start(): () => void {
    const changes = new MutationObserver(() => {
      this.place();
    });

    changes.observe(this.#list, {
      attributes: true,
      subtree: true,
      childList: true,
      attributeFilter: ["data-state", "aria-selected", "aria-checked", "aria-pressed"],
    });
    this.#sizes.observe(this.#list);
    this.place();

    return () => {
      changes.disconnect();
      this.#sizes.disconnect();
    };
  }
}

/**
 * @param active selector of the active item inside the node's parent
 * @param line draw a line of this many px under the item instead of covering it
 */
export function indicator(active: string, line = 0): Attachment<HTMLElement> {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it moves the node.
  return (node) => new Slide(node, active, line).start();
}
