// A finger on a bottom drawer (vaul), for component tests. vaul reads a drag's time off `Date`,
// which the test fakes (`vi.useFakeTimers({ toFake: ["Date"] })`) and this harness moves on.
import { expect, vi } from "vitest";
import { finish } from "../motion/animations.harness.ts";

/** How long vaul ignores drags on a drawer just opened, in ms. */
const OPENING_MS = 500;

/**
 * Puts a finger on `drawer` and moves it `dy` px down; the returned function lifts it at `dy`.
 * A drawer ignores drags while it opens, so its entrance is ended and the clock moved past it.
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
  await finish(() => drawer.getAnimations().length === 0);
  vi.setSystemTime(Date.now() + OPENING_MS);

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
 * the clock moves on before the finger lifts.
 */
export function held(release: () => void): void {
  vi.setSystemTime(Date.now() + 400);
  release();
}

/** Pulls `drawer` `dy` px down and lets go there. */
export async function pull(drawer: Element, dy: number): Promise<void> {
  (await press(drawer, dy))();
}
