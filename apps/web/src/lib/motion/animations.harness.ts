/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// Test harness: motion on no clock. Component tests run side by side under load, so none may
// wait for an animation to play out or race one to catch it: they hold it, or end it.
import { expect, vi } from "vitest";

/** Whether `a` comes to an end: a live dot pulses for good. */
const ends = (a: Animation) => a.effect?.getComputedTiming().endTime !== Infinity;

/**
 * Holds every script animation at its start, from now: a test sets its `currentTime` or ends it.
 * One without a duration still runs, as Svelte's transitions start their travel only once a
 * first, empty animation has ended. Undone by `vi.restoreAllMocks`.
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

const settled = () => document.getAnimations().every((a) => a.playState === "finished" || !ends(a));

/**
 * Until `done` holds, by default until no animation is left, ends every animation on the page that
 * ends, again on each look: one that starts as another ends (a Svelte transition, a chained
 * entrance) is ended in its turn.
 */
export async function finish(done: () => boolean = settled): Promise<void> {
  await expect
    .poll(() => {
      if (done()) return true;

      for (const a of document.getAnimations())
        if (ends(a) && a.playState !== "finished") a.finish();

      return done();
    })
    .toBe(true);
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
