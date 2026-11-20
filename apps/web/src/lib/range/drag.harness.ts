// Test harness: a finger dragging a range card, paced like a finger on the test's fake clock.
import { tick } from "svelte";
import { vi } from "vitest";

/**
 * A finger on `el` drags by `dx` px in eight moves 16 ms apart, from `share` of its width; let go
 * unless `hold`. The test fakes `performance`, which the finger's speed is read on.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM, used in place.
export async function dragBy(el: Element, dx: number, { hold = false, share = 0.5 } = {}) {
  const box = el.getBoundingClientRect();

  const at = (x: number) => ({
    pointerId: 1,
    pointerType: "touch",
    clientX: box.left + box.width * share + x,
    clientY: box.top + box.height / 2,
    bubbles: true,
  });

  el.dispatchEvent(new PointerEvent("pointerdown", at(0)));

  for (let i = 1; i <= 8; i++) {
    vi.advanceTimersByTime(16);
    el.dispatchEvent(new PointerEvent("pointermove", at((dx * i) / 8)));
  }

  if (!hold) el.dispatchEvent(new PointerEvent("pointerup", at(dx)));

  await tick();
}

/** The finger that `dragBy` held lets go. */
export function letGo(el: Element): void {
  el.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
}

/** How many panes stand beside `el`'s shown one. */
export const aside = (el: Element): number => el.querySelectorAll(".pane.aside").length;
