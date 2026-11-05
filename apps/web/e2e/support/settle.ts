/**
 * Waiting on the page's own frame clock instead of the wall clock.
 *
 * A spec that must see "nothing more happens" cannot wait for an event, so it waits for the page to
 * have had the chance: a count of rendered frames. A loaded machine renders fewer frames per second
 * and so waits longer; an idle one does not wait past the frames it asked for.
 */

import type { Page } from "@playwright/test";

/** Resolve after `count` animation frames of the page. Runs on the page's clock, fake or real. */
export function frames(page: Page, count: number): Promise<void> {
  return page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const step = (left: number) =>
          left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
        step(n);
      }),
    count,
  );
}
