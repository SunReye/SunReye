/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// Test harness: motion on no clock. Component tests run side by side under load, so none may
// wait for an animation to play out or race one to catch it: they hold it, or end it.
import { vi } from "vitest";
import { stepUntil } from "./clock.harness.ts";

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
  await stepUntil(done, end);
}

/** Ends every running animation that ends, and waits for each to say so: what follows one, the
 * next of a chain or an element's removal, runs on that event. */
async function end(): Promise<void> {
  const ending = document.getAnimations().filter((a) => ends(a) && a.playState !== "finished");

  if (ending.length === 0) {
    await frame();

    return;
  }

  await Promise.all(
    ending.map(
      (a) =>
        new Promise<void>((ended) => {
          a.addEventListener(
            "finish",
            () => {
              ended();
            },
            { once: true },
          );
          a.addEventListener(
            "cancel",
            () => {
              ended();
            },
            { once: true },
          );
          a.addEventListener(
            "remove",
            () => {
              ended();
            },
            { once: true },
          );
          a.finish();
        }),
    ),
  );
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

/**
 * The page's next frame, on which a transition starts and an ended animation's event comes: an
 * instant animation of an element off the page ends on it. Real frames, no fake clock: one comes as
 * soon as the page can draw it.
 */
export function frame(): Promise<void> {
  const animation = document.createElement("div").animate([], 0);

  return new Promise((drawn) => {
    animation.addEventListener(
      "finish",
      () => {
        drawn();
      },
      { once: true },
    );
  });
}
