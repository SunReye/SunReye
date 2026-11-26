// What the journeys do with a page: wait for a transition to land, tap, go back, swipe and drag.

import type { CDPSession, Page } from "playwright";

/** Long enough for any transition (enter 350 ms) to land under 4× throttle. */
const LAND_MS = 900;

export const land = (page: Page, ms = LAND_MS) => page.waitForTimeout(ms);

/** Runs `step` on each item, one after another. */
export async function inTurn<T>(
  items: readonly T[],
  step: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    // oxlint-disable-next-line no-await-in-loop -- one gesture after another, as a person makes them.
    await step(item);
  }
}

/** The dashboard's 3D scene has faded in and parked its car. */
export async function sceneShown(page: Page): Promise<void> {
  await page.locator("figure.shown").waitFor({ timeout: 120_000 });
  await land(page, 3000);
}

/** The builder's scene was prepared and drawn. */
export async function builderShown(page: Page): Promise<void> {
  await page.getByLabel("3D-Szene des Hauses").waitFor({ timeout: 60_000 });
  await land(page, 8000);
}

/** Back, as the browser's button: every sheet and drill level is a history entry (ADR 21). */
export async function back(page: Page): Promise<void> {
  await page.goBack();
  await land(page);
}

/** An accessible name that begins with `text`. */
const starts = (text: string) => new RegExp(`^${text}`, "u");

export async function tap(
  page: Page,
  name: string,
  role: "button" | "radio" | "tab" | "link" = "button",
): Promise<void> {
  await page
    .getByRole(role, { name: starts(name) })
    .first()
    .click();
  await land(page);
}

/** Page pixels. */
export type Pixel = readonly [number, number];

/** A finger from `from` to `to` in `steps` moves, as a swipe or a fling. */
export async function swipe(cdp: CDPSession, from: Pixel, to: Pixel, steps: number): Promise<void> {
  const at = (i: number) => ({
    x: from[0] + ((to[0] - from[0]) * i) / steps,
    y: from[1] + ((to[1] - from[1]) * i) / steps,
  });

  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(0)] });
  await inTurn(
    Array.from({ length: steps }, (_, i) => i + 1),
    async (i) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [at(i)] });
    },
  );
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A mouse drag from `from` to `to` over 30 moves, then a pause for it to land. */
export async function drag(page: Page, from: Pixel, to: Pixel): Promise<void> {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 30 });
  await page.mouse.up();
  await land(page);
}

/** The centre of the first element labelled `label`. */
export async function centre(page: Page, label: string): Promise<Pixel> {
  const box = await page.getByLabel(starts(label)).first().boundingBox();

  if (box === null) throw new Error(`${label} is not on screen`);

  return [box.x + box.width / 2, box.y + box.height / 2];
}
