import { tick } from "svelte";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Harness from "./card.harness.svelte";

/** A quick finger from `x0` to `x1`, in shares of `el`'s width, across its middle. */
function swipeOn(el: Element, x0: number, x1: number): void {
  const box = el.getBoundingClientRect();

  const at = (share: number) => ({
    clientX: box.left + box.width * share,
    clientY: box.top + box.height / 2,
    pointerType: "touch",
    pointerId: 3,
    buttons: 1,
    bubbles: true,
  });

  el.dispatchEvent(new PointerEvent("pointerdown", at(x0)));
  el.dispatchEvent(new PointerEvent("pointermove", at(x1)));
  el.dispatchEvent(new PointerEvent("pointerup", at(x1)));
}

test("on a full screen, a swipe beside the chart steps the range and one across it reads", async () => {
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await expect.element(screen.getByText("Summe")).toBeVisible();

  // Swiping left brings the later period in.
  swipeOn(screen.getByRole("heading", { name: "Heute" }).element(), 0.75, 0.25);
  expect(steps).toEqual([1]);

  swipeOn(document.querySelector("[data-scrub]")!, 0.75, 0.25);
  await tick();
  expect(steps).toEqual([1]);
  expect(screen.getByText("Band b0").query()).not.toBeNull();
});
