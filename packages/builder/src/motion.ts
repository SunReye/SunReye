import { flip as svelteFlip } from "svelte/animate";
import { motion } from "./motion/tier.svelte.ts";
import {
  crossfade,
  fade as svelteFade,
  slide as svelteSlide,
  type FadeParams,
  type SlideParams,
} from "svelte/transition";

/**
 * Every animation duration, in ms: 120–250, short enough never to hold up
 * reading, and `press`. `fast` is for what answers the pointer (hover, focus
 * and every Tailwind `transition-*`, via `--default-transition-duration`),
 * `base` for things that appear or move and for a press coming back up, `slow`
 * for large surfaces. `press` is the one below the floor: a pressed control
 * goes down in it, quicker than it comes back. The `motion` item also writes
 * them into the project's CSS as `--motion-<name>` (0ms under
 * `prefers-reduced-motion`) for what animates through CSS; a test keeps both
 * equal (ADR 0003).
 */
export const MOTION_MS = { fast: 120, base: 180, slow: 250, press: 80 } as const;

/**
 * The one easing, an ease-out (quick start, soft landing) that never overshoots,
 * so nothing bounces. The CSS side is `--motion-ease`, which Tailwind's
 * `--default-transition-timing-function` points at; a test keeps both equal.
 * Reduced motion doesn't change it: with a duration of 0 it never plays.
 */
export const MOTION_EASE = "cubic-bezier(0.215, 0.61, 0.355, 1)";

/**
 * The light spring, for what moves or appears (a press coming back up, an overlay's scale-in, the
 * tabs indicator): it overshoots its target by about 5% of the way and settles, once, with no
 * ringing. Never for colour, opacity or progress, and not on dense surfaces (table rows, menu
 * items, form fields). `--motion-spring` in CSS; a test keeps both equal and pins the overshoot.
 */
export const MOTION_SPRING = "cubic-bezier(0.25, 1.4, 0.5, 1)";

/**
 * The soft spring, for what should settle calmly: a button's release (a press coming back up and a
 * hover lift). It overshoots by about 1% of the way, against the light spring's 5%, so a control
 * the user hits often (Save) does not bounce. Cards, toggles, the checkbox tick and sidebar rows
 * keep `MOTION_SPRING`. `--motion-spring-soft` in CSS; a test keeps both equal and pins the overshoot.
 */
export const MOTION_SPRING_SOFT = "cubic-bezier(0.3, 1.08, 0.5, 1)";

/**
 * `ms`, or 0 on the still tier (reduced motion, low power). Every transition, animation
 * and tween takes its duration from here.
 */
export function motionMs(ms: number, reduced: boolean = motion.still): number {
  return reduced ? 0 : ms;
}

/**
 * `MOTION_EASE` as a function of progress, for Svelte's transitions and animations, which take an
 * easing function rather than a CSS string. Solves the curve's x for the given progress by
 * bisection and returns its y.
 */
export const ease = (() => {
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = (/\(([^)]+)\)/.exec(MOTION_EASE)?.[1] ?? "")
    .split(",")
    .map(Number);

  const bezier = (a: number, b: number, s: number) =>
    3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;

  return (t: number) => {
    if (t <= 0 || t >= 1) return Math.min(Math.max(t, 0), 1);
    let [lo, hi] = [0, 1];

    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;

      if (bezier(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }

    return bezier(y1, y2, (lo + hi) / 2);
  };
})();

type Duration = { duration?: number };

// svelte/transition's own, with our default duration and easing and reduced motion applied.

export function fade(node: Element, params: Omit<FadeParams, "easing"> & Duration = {}) {
  return svelteFade(node, {
    ...params,
    duration: motionMs(params.duration ?? MOTION_MS.base),
    easing: ease,
  });
}

export function slide(node: Element, params: Omit<SlideParams, "easing"> & Duration = {}) {
  return svelteSlide(node, {
    ...params,
    duration: motionMs(params.duration ?? MOTION_MS.base),
    easing: ease,
  });
}

export function flip(node: Element, fromTo: { from: DOMRect; to: DOMRect }, params: Duration = {}) {
  return svelteFlip(node, fromTo, {
    duration: motionMs(params.duration ?? MOTION_MS.slow),
    easing: ease,
  });
}

/**
 * For a row that takes the place of another, such as a final taking the place
 * of its live text: `leave` on the outgoing row, `arrive` on the incoming one,
 * each with the same key. A row that arrives as its key leaves appears in
 * place, at once; any other arriving row fades in, and a row that leaves
 * without a successor goes at once. A fade, not a fly: a newest row moving in
 * from below grew the scroll height under a log that follows it, and the log
 * lost the bottom.
 */
export function handoff() {
  const [send, receive] = crossfade({
    duration: 0,
    fallback: (node, _params, intro) => (intro ? fade(node) : { duration: 0 }),
  });

  return {
    leave: (node: Element, key: string) => send(node, { key }),
    /** With no key, the row has no predecessor and fades in. */
    arrive: (node: Element, key: string | undefined) =>
      key === undefined ? fade(node) : receive(node, { key }),
  };
}
