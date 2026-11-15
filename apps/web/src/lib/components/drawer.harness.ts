// A finger on a bottom drawer (vaul), for component tests.
import { expect, vi } from "vitest";

/**
 * Puts a finger on `drawer` and moves it `dy` px down; the returned function lifts it at `dy`.
 * A drawer ignores drags while it opens, so the press repeats until the drawer follows.
 */
export async function press(drawer: Element, dy: number): Promise<() => void> {
  if (!(drawer instanceof HTMLElement)) throw new TypeError("no drawer");

  // A synthetic pointer has no capture to take.
  drawer.setPointerCapture = () => {};

  const { left, top } = drawer.getBoundingClientRect();

  const fire = (type: string, y: number) =>
    drawer.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        clientX: left + 40,
        clientY: top + 20 + y,
        bubbles: true,
      }),
    );

  // A press while the entrance plays would read its keyframes as a drag.
  await expect.poll(() => drawer.getAnimations().length).toBe(0);

  // The drag writes its offset inline.
  const dragged = () => drawer.style.transform.includes(`${dy}px`);

  await expect
    .poll(() => {
      if (!dragged()) {
        fire("pointerup", 0);
        fire("pointerdown", 0);
        fire("pointermove", dy);
      }

      return dragged();
    })
    .toBe(true);

  return () => {
    fire("pointerup", dy);
  };
}

/**
 * Lifts a finger that held still: the drawer tells a fling by the drag's speed on the clock, so
 * the clock reads later while the finger lifts and no test waits the hold out.
 */
export function held(release: () => void): void {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 400 });

  try {
    release();
  } finally {
    vi.useRealTimers();
  }
}

/** Pulls `drawer` `dy` px down and lets go there. */
export async function pull(drawer: Element, dy: number): Promise<void> {
  (await press(drawer, dy))();
}
