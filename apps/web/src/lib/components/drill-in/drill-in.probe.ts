// What the drill-in's tests read off the page, on frames the test plays (`fakeFrames`).
import { tick } from "svelte";
import { vi } from "vitest";
import { framesUntil } from "../../motion/clock.harness.ts";

/** One frame on the fake clock, its updates drawn. */
export async function frame(): Promise<void> {
  vi.advanceTimersToNextFrame();
  await tick();
}

export function child(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-drill=page]");
}

/** How far the child page sits right of its place, in % of the width; 100 when it is gone. */
export function offset(): number {
  const transform = child()?.style.transform;

  return transform === undefined || transform === ""
    ? 100
    : Number(/translateX\(([-\d.]+)%\)/u.exec(transform)?.[1]);
}

export const until = framesUntil;

export function rect(element: Element | null | undefined): DOMRect {
  if (!element) throw new Error("missing element");

  return element.getBoundingClientRect();
}

/** Browser back, once the route has heard it. */
export async function browserBack(): Promise<void> {
  const popped = new Promise((resolve) => {
    addEventListener("popstate", resolve, { once: true });
  });

  history.back();
  await popped;
  await tick();
}

/** Scrolls the window to `y`, once the page has heard it, as a finger's scroll is. */
export async function scrolled(y: number): Promise<void> {
  const heard = new Promise((resolve) => {
    addEventListener("scroll", resolve, { once: true });
  });

  scrollTo(0, y);
  await heard;
}
