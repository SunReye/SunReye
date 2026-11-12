// PROTOTYPE: height changes without a jump (ADR 21), on transforms alone.
// `Flip` carries whatever sits below a box that changed height from its old place to its new one.
// `edge` moves the box's own bottom edge: growing, the box is revealed through a wrapper that moves
// against it (the content stands still, the clip edge travels); shrinking, a plain surface the size
// of what was lost retracts under the new edge. Layout changes once, at the start, in both cases.
import type { Attachment } from "svelte/attachments";
import { tween } from "../animate";
import { motion } from "../motion/tier.svelte";

const MOVE = 300;
/** A switch arms the animation for this long; any other reflow lands at once. */
const ARMED = 900;

// One element can be moved by its own edge and by a neighbour's: the offsets add up.
const offsets = new WeakMap<HTMLElement, Map<string, number>>();
function shift(el: HTMLElement, source: string, y: number): void {
  let map = offsets.get(el);
  if (!map) offsets.set(el, (map = new Map()));
  if (y) map.set(source, y);
  else map.delete(source);
  let sum = 0;
  for (const v of map.values()) sum += v;
  el.style.transform = sum ? `translateY(${sum.toFixed(2)}px)` : "";
}

/** The element's place in the document by layout alone: a running transform does not move it. */
function docTop(el: HTMLElement): number {
  let top = 0;
  for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) top += e.offsetTop;
  return top;
}

export class Flip {
  #items = new Map<HTMLElement, { top: number; y: number; stop?: () => void }>();
  #until = 0;
  #boxes = new Map<Element, (h: number, w: number) => null | "sync" | (() => void)>();
  // One observer for every box: a batch of size changes is read once, then written once, so the
  // browser lays the page out a single time for it.
  #sizes =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          const runs: (() => void)[] = [];
          let sync = false;
          for (const e of entries) {
            const size = e.borderBoxSize[0]!;
            const out = this.#boxes.get(e.target)?.(Math.round(size.blockSize), Math.round(size.inlineSize));
            if (out === "sync") sync = true;
            else if (out) runs.push(out);
          }
          if (runs.length) this.play();
          else if (sync) this.sync();
          for (const run of runs) run();
        });

  /** Watch a box's size; the answer says what to do about a change. */
  box(el: Element, changed: (h: number, w: number) => null | "sync" | (() => void)): () => void {
    this.#boxes.set(el, changed);
    this.#sizes?.observe(el);
    return () => {
      this.#boxes.delete(el);
      this.#sizes?.unobserve(el);
    };
  }

  /** Follow this element: it glides when layout moves it. */
  track: Attachment<HTMLElement> = (node) => {
    this.#items.set(node, { top: docTop(node), y: 0 });
    return () => {
      this.#items.get(node)?.stop?.();
      this.#items.delete(node);
    };
  };

  /** A switch is about to change layout. */
  arm(): void {
    this.#until = performance.now() + ARMED;
  }
  get armed(): boolean {
    return !motion.still && performance.now() < this.#until;
  }

  /** Layout moved for another reason (a resize, data landing): take the new places as they are. */
  sync(): void {
    for (const [node, it] of this.#items) it.top = docTop(node);
  }

  /** Layout just changed: carry every followed element from where it was to where it is now. */
  play(): void {
    for (const [node, it] of this.#items) {
      const now = docTop(node);
      const moved = it.top - now;
      it.top = now;
      if (Math.abs(moved) < 0.5) continue;
      it.stop?.();
      // From wherever it is drawn now, mid-flight included; placed there in this frame, before the tween's first.
      const place = (v: number) => {
        it.y = v;
        shift(node, "flip", v);
      };
      const from = it.y + moved;
      place(from);
      it.stop = tween(from, 0, MOVE, place);
    }
  }
}

/** On a wrapper whose first child is the box: the box's bottom edge travels to its new height. */
export function edge(flip: Flip): Attachment<HTMLElement> {
  return (wrap) => {
    const box = wrap.firstElementChild as HTMLElement;
    let h = box.offsetHeight;
    let w = box.offsetWidth;
    // Where the bottom edge is drawn; it runs after `h`.
    let v = h;
    let stop: (() => void) | undefined;
    let ghost: HTMLElement | null = null;
    let lost = 0;

    function draw(): void {
      const hidden = Math.max(0, h - v);
      wrap.style.overflow = hidden ? "hidden" : "";
      shift(wrap, "edge", -hidden);
      shift(box, "edge", hidden);
      if (ghost) (ghost.firstElementChild as HTMLElement).style.transform = `translateY(${(Math.max(0, v - h) - lost).toFixed(2)}px)`;
    }
    function rest(): void {
      stop?.();
      v = h;
      ghost?.remove();
      ghost = null;
      draw();
    }
    function run(): void {
      stop?.();
      ghost?.remove();
      ghost = null;
      if (v > h) {
        // What the box lost, as a plain surface under the new edge: no blur, it is gone in 300 ms.
        const style = getComputedStyle(box);
        lost = Math.ceil(v - h);
        ghost = document.createElement("div");
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.cssText = `position:absolute;left:${box.offsetLeft}px;width:${w}px;top:${box.offsetTop + h}px;height:${lost}px;overflow:hidden;pointer-events:none;`;
        const surface = document.createElement("div");
        surface.style.cssText = `position:absolute;inset:0;background-color:${style.backgroundColor};border:1px solid color-mix(in oklab, var(--foreground) 10%, transparent);border-top:0;border-radius:0 0 ${style.borderBottomLeftRadius} ${style.borderBottomLeftRadius};`;
        ghost.append(surface);
        wrap.append(ghost);
      }
      draw();
      stop = tween(v, h, MOVE, (x) => {
        v = x;
        draw();
      }, rest);
    }

    wrap.style.position = "relative";
    const off = flip.box(box, (nh, nw) => {
      if (nh === h && nw === w) return null;
      const reflow = nw !== w;
      [h, w] = [nh, nw];
      if (reflow || !flip.armed) {
        rest();
        return "sync";
      }
      return run;
    });
    return () => {
      off();
      stop?.();
      ghost?.remove();
    };
  };
}
