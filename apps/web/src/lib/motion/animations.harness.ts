/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// Test harness: motion on no clock. Component tests run side by side under load, so none may
// wait for an animation to play out, race one to catch it, or wait for a frame to be told one
// ended: the browser tells an end only on a frame it draws, so the harness tells it itself.
import { vi } from "vitest";
import { playFrame, stepUntil } from "./clock.harness.ts";

/** Whether `a` comes to an end: a live dot pulses for good. */
const ends = (a: Animation) => a.effect?.getComputedTiming().endTime !== Infinity;

const styled = (a: Animation): a is CSSAnimation | CSSTransition =>
  a instanceof CSSAnimation || a instanceof CSSTransition;

/** Animations the harness has ended. */
const ended = new WeakSet<Animation>();

/** Per element, the style animations whose end the harness told: the browser's word, a frame
 * later, is dropped. */
const told = new WeakMap<EventTarget, Set<string>>();

const named = (event: AnimationEvent | TransitionEvent) =>
  `${event instanceof AnimationEvent ? event.animationName : event.propertyName}|${event.pseudoElement}`;

/** The browser's own end of a style animation the harness ended: dropped before any listener. */
function drop(event: Event): void {
  if (!event.isTrusted || event.target === null) return;

  if (!(event instanceof AnimationEvent || event instanceof TransitionEvent)) return;

  if (told.get(event.target)?.delete(named(event)) === true) event.stopImmediatePropagation();
}

/** Its element's `animationend` or `transitionend`, as the browser tells it on its next frame. */
function styleEnd(a: CSSAnimation | CSSTransition): AnimationEvent | TransitionEvent {
  const effect = a.effect instanceof KeyframeEffect ? a.effect : null;
  const active = Number(effect?.getComputedTiming().activeDuration);

  const init = {
    bubbles: true,
    // An endless run of no length has no length either.
    elapsedTime: Number.isFinite(active) ? active / 1000 : 0,
    pseudoElement: effect?.pseudoElement ?? "",
  };

  return a instanceof CSSAnimation
    ? new AnimationEvent("animationend", { ...init, animationName: a.animationName })
    : new TransitionEvent("transitionend", { ...init, propertyName: a.transitionProperty });
}

/**
 * Ends `a` and tells so, as the browser would on its next frame. A script animation is held at
 * its end and told by its own event, so the browser never tells it again. A style animation is
 * finished, which settles its `finished`, and told by its element's event.
 */
function end(a: Animation): void {
  ended.add(a);

  if (!styled(a)) {
    a.pause();
    a.currentTime = Number(a.effect?.getComputedTiming().endTime);
    a.dispatchEvent(
      new AnimationPlaybackEvent("finish", {
        currentTime: a.currentTime,
        timelineTime: document.timeline.currentTime,
      }),
    );

    return;
  }

  a.finish();

  const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;

  if (target === null || target === undefined) return;

  const event = styleEnd(a);
  const kept = told.get(target) ?? new Set<string>();

  kept.add(named(event));
  told.set(target, kept);
  target.dispatchEvent(event);
}

/**
 * Tells an animation of no length it ended a microtask on, once its caller has said what follows
 * its end. The browser has it ended already and tells it on its next frame: its handler is kept
 * from the browser, which tells no one.
 */
function instant(animation: Animation): void {
  let handler: Animation["onfinish"] = null;

  Object.defineProperty(animation, "onfinish", {
    configurable: true,
    get: () => handler,
    set: (to: Animation["onfinish"]) => {
      handler = to;
    },
  });
  queueMicrotask(() => {
    if (animation.playState === "idle") return;

    ended.add(animation);
    handler?.call(
      animation,
      new AnimationPlaybackEvent("finish", {
        currentTime: animation.currentTime,
        timelineTime: document.timeline.currentTime,
      }),
    );
  });
}

/**
 * Puts the page's motion on the harness, for every test (`page.setup.ts`): an animation of no
 * length (a Svelte transition's first, empty one) ends at once, not on a frame.
 */
export function watchAnimations(): void {
  // oxlint-disable-next-line typescript/unbound-method -- called below with each element as its `this`.
  const animate = Element.prototype.animate;

  Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
    const animation = animate.apply(this, args);

    if (animation.effect?.getComputedTiming().endTime === 0) instant(animation);

    return animation;
  };

  addEventListener("animationend", drop, { capture: true });
  addEventListener("transitionend", drop, { capture: true });
}

/**
 * Holds every script animation at its start, from now: a test sets its `currentTime` or ends it.
 * Undone by `vi.restoreAllMocks`.
 */
export function hold(): void {
  // oxlint-disable-next-line typescript/unbound-method -- called below with each element as its `this`.
  const animate = Element.prototype.animate;

  vi.spyOn(Element.prototype, "animate").mockImplementation(function (
    this: Element,
    ...args: Parameters<Element["animate"]>
  ) {
    const animation = animate.apply(this, args);

    if (Number(animation.effect?.getComputedTiming().duration) > 0) animation.pause();

    return animation;
  });
}

/** The animations on the page still to end: one played out on its own has been told already. */
const ending = () =>
  document.getAnimations().filter((a) => ends(a) && !ended.has(a) && a.playState !== "finished");

const settled = () => ending().length === 0;

/**
 * Until `done` holds, by default until no animation is left to end, ends every animation on the
 * page that ends, again on each look: one that starts as another ends (a Svelte transition, a
 * chained entrance) is ended in its turn. What the page waits on a frame for (a library's frame
 * callback before it reads its animations, a size) is done on each look too.
 */
export async function finish(done: () => boolean = settled): Promise<void> {
  await stepUntil(done, () => {
    for (const a of ending()) end(a);

    playFrame();
  });
}

/**
 * Holds every CSS animation at its start until the returned function lets them go: a test reads
 * an entrance before it has played out, and ends it with `finish`. For `beforeEach`.
 */
export function holdEntrances(): () => void {
  const style = document.createElement("style");

  style.textContent = "*, *::before, *::after { animation-play-state: paused !important; }";
  document.head.append(style);

  return () => {
    style.remove();
  };
}
