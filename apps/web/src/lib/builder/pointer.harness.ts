// A real pointer through the browser's input pipeline, for the builder's component tests.
import { cdp, type Locator } from "vitest/browser";

export type Pointer = "mouse" | "pen" | "touch";

/** A real pointer, through the browser's input pipeline, from `from` to `to` in page pixels. */
export async function press(
  kind: Pointer,
  path: readonly (readonly [number, number])[],
): Promise<void> {
  const [first, ...rest] = path;

  if (first === undefined) return;

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

/** The finite animations moving `element` or anything around it, such as a sliding sheet. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element, read only.
const moving = (element: Element): Promise<Animation>[] =>
  document
    .getAnimations()
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own, read only.
    .filter((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;

      return (
        target?.contains(element) === true &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime)
      );
    })
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own, read only.
    .map((animation) => animation.finished);

/** Resolves once `element` stops moving: its animations end and its box holds still a frame. */
async function settled(element: Element): Promise<void> {
  // A transition that has not drawn its first frame yet looks still to the box alone.
  await Promise.allSettled(moving(element));

  let box = "";

  for (let i = 0; i < 60; i++) {
    const was = box;

    // oxlint-disable-next-line no-await-in-loop -- one frame at a time.
    await new Promise<void>((done) => {
      requestAnimationFrame(() => {
        done();
      });
    });
    box = JSON.stringify(element.getBoundingClientRect());

    if (box === was) return;
  }
}

/** One finger taps the middle of what `locator` finds, through the browser's touch input. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- vitest's locator, read only.
export async function tap(locator: Locator): Promise<void> {
  const element = await locator.findElement();

  // A finger scrolls a long sheet to what it taps first.
  element.scrollIntoView({ block: "nearest" });

  // A finger aims at where the target rests: a sheet still sliding would take the tap elsewhere.
  await settled(element);

  const { left, top, width, height } = element.getBoundingClientRect();

  await press("touch", [[left + width / 2, top + height / 2]]);
}
