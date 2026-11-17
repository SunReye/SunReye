// ADR 21's movement between two resting places, shared by the route slide, the settings levels,
// the builder's inspector and the weather detail's days.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import type { TransitionConfig } from "svelte/transition";
import { motionMs } from "../motion.ts";
import { easeInOut } from "./ease.ts";

const SLIDE_MS = 300;

/** A slide's time and curve; 0 ms on the still tier. */
export function slideTiming() {
  return { duration: motionMs(SLIDE_MS), easing: easeInOut };
}

/** A transition: in from the right for 1, from the left for -1; as an `out:`, away to that side. */
export function slideIn(_node: Element, way: -1 | 1): TransitionConfig {
  return {
    ...slideTiming(),
    css: (_t, u) => `transform: translate3d(${way * 100 * u}%, 0, 0)`,
  };
}

/** Where a node is drawn now, when a travel of its own is under way; that travel stops there. */
export function caught(node: HTMLElement) {
  const running = node.getAnimations();

  if (running.length === 0) return { x: 0, opacity: 1 };

  const style = getComputedStyle(node);
  const at = { x: new DOMMatrix(style.transform).m41, opacity: Number(style.opacity) };

  for (const animation of running) animation.pause();

  return at;
}

/**
 * An `out:` from `at`, where `caught` found the node: away to the left for 1, to the right for -1.
 * A second change mid-slide goes on from where the node is.
 */
export function slideAway(at: Readonly<ReturnType<typeof caught>>, way: -1 | 1): TransitionConfig {
  return {
    ...slideTiming(),
    css: (t, u) =>
      `transform: translate3d(calc(${at.x * t}px + ${-way * 100 * u}%), 0, 0); opacity: ${at.opacity}`,
  };
}

/**
 * The way of each change of what is shown, starting on `first`: asked with what is now shown by
 * the arriving and the leaving node of one change, in either order. `none` until the first change.
 */
export function turns<K, W>(first: K, none: W, wayTo: (from: K, to: K) => W): (to: K) => W {
  let shown = first;
  let way = none;

  return (to) => {
    if (to !== shown) {
      way = wayTo(shown, to);
      shown = to;
    }

    return way;
  };
}

/**
 * The level a deeper one slides over: as an `out:` it shifts left and dims, as an `in:` it comes
 * back.
 */
export function shiftAside(_node: Element): TransitionConfig {
  return {
    ...slideTiming(),
    css: (_t, u) => `transform: translate3d(${-30 * u}%, 0, 0); opacity: ${1 - 0.6 * u}`,
  };
}
