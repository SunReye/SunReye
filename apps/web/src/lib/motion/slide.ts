// ADR 21's movement between two resting places, shared by the route slide, the settings levels and
// the builder's inspector.
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
