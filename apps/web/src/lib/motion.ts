import { flip as svelteFlip } from "svelte/animate";
import { prefersReducedMotion } from "svelte/motion";
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
 * `ms`, or 0 when the user prefers reduced motion. Every transition, animation
 * and tween takes its duration from here.
 */
export function motionMs(ms: number, reduced: boolean = prefersReducedMotion.current): number {
  return reduced ? 0 : ms;
}

/**
 * `MOTION_EASE` as a function of progress, for Svelte's transitions and animations, which take an
 * easing function rather than a CSS string. Solves the curve's x for the given progress by
 * bisection and returns its y.
 */
const ease = (() => {
  const [x1, y1, x2, y2] = MOTION_EASE.match(/\(([^)]+)\)/)![1]
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

/** Whether `el`, or a wrapper of it below `list`, is out of the flow with an inline `position: absolute`: a row Svelte is fading out. */
function leaving(el: HTMLElement, list: HTMLElement) {
  for (let node: HTMLElement | null = el; node && node !== list; node = node.parentElement)
    if (node.style.position === "absolute") return true;

  return false;
}

/**
 * Keeps the box of a list's active child in `--<prefix>-indicator-left|top|width|height` on the
 * list and marks the list `data-indicator` while there is one. The list draws its indicator from
 * these variables with a `transition-[left,top,width,height]`, so a selection that switches
 * between siblings slides (and resizes) instead of snapping; `--motion-*` is 0 under reduced
 * motion, so it then jumps at once. The first box is set together with `data-indicator`, so
 * nothing animates in from nowhere, and neither does a list first laid out after `display: none`
 * (no box and no `data-indicator` while it has no layout). The list must be positioned (`relative`).
 *
 * - `active`: selector of the active child, matched anywhere under the list.
 * - `attributes`: attributes whose change moves the active child (`class` and `dir` are always
 *   watched: a `dir` flip on the list or any ancestor, or a class that re-aligns the list).
 * - `paddingBox`: measure the active child's padding box (inside its border), for a row whose
 *   border sits outside the indicator.
 * - `radius`: also keep the active child's corner radii in `--<prefix>-indicator-radius`, for an
 *   indicator that has to follow a child's rounding (a pill, or the end of a joined row).
 *
 * Positions come from layout (`offset*`), not from `getBoundingClientRect`, so a transform in
 * flight on a row or a wrapper (e.g. `animate:flip`) doesn't move the target.
 */
export function trackActive(
  list: HTMLElement,
  options: {
    active: string;
    prefix: string;
    attributes: string[];
    paddingBox?: boolean;
    radius?: boolean;
  },
) {
  const { active, prefix, attributes, paddingBox = false, radius = false } = options;
  let observed: Element | null = null;

  const place = () => {
    // Not a match inside a row Svelte is fading out: it stays in the DOM, out of the flow (inline
    // `position: absolute`), with its `aria-current` until the transition ends.
    const el = [...list.querySelectorAll<HTMLElement>(active)].find(
      (match) => !leaving(match, list),
    );

    if (!el) {
      list.removeAttribute("data-indicator");

      return;
    }

    if (el !== observed) {
      // A direct child of the list stays observed for its size, whether or not it is the active one.
      if (observed && observed.parentElement !== list) resizes.unobserve(observed);
      resizes.observe(el);
      observed = el;
    }

    // Not laid out (`display: none` on the list, an ancestor or the child): there is nothing to
    // measure, and the zeros it would give make the box grow from the top-left once the list is
    // shown. Drop the indicator, so the items' own look shows; the first measurement after the
    // list is laid out sets the box together with `data-indicator`, like the first paint.
    if (!list.getClientRects().length || !el.getClientRects().length) {
      list.removeAttribute("data-indicator");

      return;
    }

    // The position in the list's padding box: this element's own offset plus every positioned
    // ancestor's between it and the list.
    let left = el.offsetLeft;
    let top = el.offsetTop;

    for (let node = el.offsetParent; node && node !== list; node = node.offsetParent) {
      if (!(node instanceof HTMLElement)) break;
      left += node.offsetLeft + node.clientLeft;
      top += node.offsetTop + node.clientTop;
    }

    const box = paddingBox
      ? {
          left: left + el.clientLeft,
          top: top + el.clientTop,
          width: el.clientWidth,
          height: el.clientHeight,
        }
      : { left, top, width: el.offsetWidth, height: el.offsetHeight };

    for (const [name, px] of Object.entries(box))
      list.style.setProperty(`--${prefix}-indicator-${name}`, `${px}px`);

    if (radius) {
      // The four corners, each as horizontal and vertical radius (`a b c d / e f g h`).
      const style = getComputedStyle(el);

      const corners = (["TopLeft", "TopRight", "BottomRight", "BottomLeft"] as const).map(
        (corner) => style[`border${corner}Radius`].split(" "),
      );

      list.style.setProperty(
        `--${prefix}-indicator-radius`,
        `${corners.map((c) => c[0]).join(" ")} / ${corners.map((c) => c[1] ?? c[0]).join(" ")}`,
      );
    }

    list.setAttribute("data-indicator", "");
  };

  // Children change size when fonts load or their content does; the list when the layout does.
  const resizes = new ResizeObserver(place);

  const observeSizes = () => {
    resizes.disconnect();
    observed = null;
    resizes.observe(list);

    for (const child of list.children) resizes.observe(child);
  };

  const mutations = new MutationObserver((records) => {
    if (records.some((record) => record.type === "childList")) observeSizes();
    place();
  });

  mutations.observe(list, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [...attributes, "class", "dir"],
  });

  const directions = new MutationObserver((records) => {
    if (records.some((record) => record.target.contains(list))) place();
  });

  directions.observe(list.ownerDocument.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["dir"],
  });
  observeSizes();
  place();

  return () => {
    mutations.disconnect();
    directions.disconnect();
    resizes.disconnect();
    // Not tracking any more: the list's own look (an item's, for a group that stops tracking).
    list.removeAttribute("data-indicator");
  };
}
