// A detail's days slide by their order (ADR 21, ADR 23 "Dashboard"), as route changes do
// (ADR 21): a later day in from the right while the old one leaves to the left, an earlier one
// the other way.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import type { TransitionConfig } from "svelte/transition";
import { caught, slideAway, slideIn, turns } from "../motion/slide.ts";

/** 1 towards a later day, -1 an earlier one, 0 before any switch. */
type Way = -1 | 0 | 1;

const STANDS: TransitionConfig = { duration: 0 };

/**
 * The days' transitions for one detail, which opens on the day that starts at `first`. Both take
 * the start of the day now shown: `enter` on the day arriving, `leave` on each one going.
 */
export function daySlide(first: number) {
  const turn = turns<number, Way>(first, 0, (from, to) => (to > from ? 1 : -1));

  return {
    enter(node: HTMLElement, to: number): TransitionConfig {
      const way = turn(to);

      return way === 0 ? STANDS : slideIn(node, way);
    },
    leave(node: HTMLElement, to: number): TransitionConfig {
      const way = turn(to);

      return way === 0 ? STANDS : slideAway(caught(node), way);
    },
  };
}
