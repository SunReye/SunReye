// A real pointer through the browser's input pipeline, for the builder's component tests.
import { expect } from "vitest";
import { cdp, type Locator } from "vitest/browser";
import { finish } from "../motion/animations.harness.ts";

export type Pointer = "mouse" | "pen" | "touch";

/** Until no closing drawer's scrim is left: it covers the page until its fade has ended. */
async function uncovered(): Promise<void> {
  await finish(
    () => document.querySelector('[data-slot="drawer-overlay"][data-state="closed"]') === null,
  );
}

/** A real pointer, through the browser's input pipeline, from `from` to `to` in page pixels. */
export async function press(
  kind: Pointer,
  path: readonly (readonly [number, number])[],
): Promise<void> {
  const [first, ...rest] = path;

  if (first === undefined) return;

  await uncovered();

  if (kind === "touch") {
    await cdp().send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: first[0], y: first[1] }],
    });

    for (const [x, y] of rest) {
      // oxlint-disable-next-line no-await-in-loop -- a pointer moves one step at a time.
      await cdp().send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }

    await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    return;
  }

  const mouse = { button: "left", pointerType: kind, clickCount: 1 } as const;

  await cdp().send("Input.dispatchMouseEvent", {
    ...mouse,
    type: "mousePressed",
    x: first[0],
    y: first[1],
  });

  for (const [x, y] of rest) {
    // oxlint-disable-next-line no-await-in-loop -- a pointer moves one step at a time.
    await cdp().send("Input.dispatchMouseEvent", {
      ...mouse,
      type: "mouseMoved",
      buttons: 1,
      x,
      y,
    });
  }

  const [x, y] = rest.at(-1) ?? first;

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased", x, y });
}

/** One finger taps the middle of what `locator` finds, through the browser's touch input. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- vitest's locator, read only.
export async function tap(locator: Locator): Promise<void> {
  const element = await locator.findElement();

  // A finger scrolls a long sheet to what it taps first.
  element.scrollIntoView({ block: "nearest" });

  // A finger aims at where the target rests: a sheet still sliding would take the tap elsewhere.
  const middle = (): [number, number] => {
    const { left, top, width, height } = element.getBoundingClientRect();

    return [left + width / 2, top + height / 2];
  };

  await finish(() => element.contains(document.elementFromPoint(...middle())));

  // A drawer leaving or focus coming back moves the page without an animation: two looks agree.
  let last = "";

  await expect
    .poll(() => {
      const was = last;

      last = JSON.stringify(element.getBoundingClientRect());

      return last === was && element.contains(document.elementFromPoint(...middle()));
    })
    .toBe(true);
  await press("touch", [middle()]);
}
