// What the drill-in's tests read off the page.
import { expect } from "vitest";

export function frame(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
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

export async function until(done: () => boolean): Promise<void> {
  await expect.poll(done, { timeout: 2000 }).toBe(true);
}

export function rect(element: Element | null | undefined): DOMRect {
  if (!element) throw new Error("missing element");

  return element.getBoundingClientRect();
}
