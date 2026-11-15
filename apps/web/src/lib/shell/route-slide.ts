// Route changes slide by navigation order (ADR 21): a later screen comes in from the right while
// the old one leaves to the left, an earlier one the other way. A route outside the order fades.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import type { TransitionConfig } from "svelte/transition";
import { ease, MOTION_MS, motionMs } from "../motion.ts";
import { slideIn, slideTiming } from "../motion/slide.ts";
import { mute } from "../motion/mute.ts";
import { motion } from "../motion/tier.svelte.ts";
import { BAR, MORE } from "./nav.ts";

/** Dashboard · History · Forecast, then More's rows. */
const ORDER = [...BAR, ...MORE].map((item) => item.route);

export type Route = string | null;

/** 1 towards a later screen, -1 an earlier one, 0 when either is outside the navigation. */
type Way = -1 | 0 | 1;

function wayTo(from: Route, to: Route): Way {
  const [a, b] = [ORDER.indexOf(from ?? ""), ORDER.indexOf(to ?? "")];

  if (a < 0 || b < 0 || a === b) return 0;

  return b > a ? 1 : -1;
}

/**
 * Screens still on their way in. Only these are read as they leave: reading a screen at rest forces
 * the style of the screen arriving beside it, inside the task that mounts it.
 */
const arriving = new WeakSet<HTMLElement>();

function arrives(node: HTMLElement): void {
  arriving.add(node);
  node.addEventListener(
    "introend",
    () => {
      arriving.delete(node);
    },
    { once: true },
  );
}

/** Where a screen is drawn now, when a travel of its own is under way; that travel stops there. */
function caught(node: HTMLElement) {
  if (!arriving.has(node)) return { x: 0, opacity: 1 };

  const running = node.getAnimations();

  if (running.length === 0) return { x: 0, opacity: 1 };

  const style = getComputedStyle(node);
  const at = { x: new DOMMatrix(style.transform).m41, opacity: Number(style.opacity) };

  for (const animation of running) animation.pause();

  return at;
}

/**
 * Keeps a leaving screen where it was while the page scrolls under it: the router puts the next
 * screen at its own scroll position, and the old one would jump with it.
 */
function hold(screen: HTMLElement, marker: Element): void {
  const from = scrollY;
  const done = new AbortController();

  addEventListener(
    "scroll",
    () => {
      if (screen.isConnected) screen.style.translate = `0 ${scrollY - from}px`;
      else done.abort();
    },
    { passive: true, signal: done.signal },
  );
  marker.addEventListener(
    "outroend",
    () => {
      done.abort();
    },
    { once: true },
  );
}

function enter(node: HTMLElement, way: Way): TransitionConfig {
  if (!motion.still) arrives(node);

  if (way === 0)
    return { duration: motionMs(MOTION_MS.base), easing: ease, css: (t) => `opacity: ${t}` };

  return slideIn(node, way);
}

/** A frame of a leaving screen's travel, `u` of the way out. */
type Frame = (u: number) => Keyframe;

/** The travel as keyframes a frame apart, eased here: a transition's own easing is a function. */
function travel(frame: Frame, easing: (t: number) => number, duration: number): Keyframe[] {
  const n = Math.ceil(duration / (1000 / 60));

  return Array.from({ length: n + 1 }, (_, i) => frame(easing(i / n)));
}

/**
 * The outro of a leaving screen, borne by an empty marker inside it: Svelte makes the element that
 * bears an outro inert, which restyles its whole subtree in the task that mounts the next screen.
 * The marker waits the travel out; the screen itself is moved here, and muted instead.
 */
function leave(marker: HTMLElement, way: Way): TransitionConfig {
  const screen = marker.parentElement;
  const slide = slideTiming();
  const duration = way === 0 ? motionMs(MOTION_MS.base) : slide.duration;

  if (duration === 0 || screen === null) return { duration: 0 };

  // A second change mid-slide: this screen goes on from where it is.
  const at = caught(screen);

  hold(screen, marker);
  mute(screen);

  const frame: Frame =
    way === 0
      ? (u) => ({ transform: `translate3d(${at.x}px, 0, 0)`, opacity: at.opacity * (1 - u) })
      : (u) => ({
          transform: `translate3d(calc(${at.x * (1 - u)}px + ${-way * 100 * u}%), 0, 0)`,
          opacity: at.opacity,
        });

  screen.animate(travel(frame, way === 0 ? ease : slide.easing, duration), {
    duration,
    fill: "forwards",
  });

  return { duration };
}

/**
 * The screens' transitions for one shell, which starts on `first`. Both take the route now shown:
 * `enter` on the screen arriving, `leave` on the marker inside each one going.
 */
export function routeSlide(first: Route) {
  let shown = first;
  let way: Way = 0;

  // Asked by the arriving and the leaving screen of one change, in either order.
  const turn = (to: Route) => {
    if (to !== shown) {
      way = wayTo(shown, to);
      shown = to;
    }

    return way;
  };

  return {
    enter: (node: HTMLElement, to: Route) => enter(node, turn(to)),
    leave: (node: HTMLElement, to: Route) => leave(node, turn(to)),
  };
}
