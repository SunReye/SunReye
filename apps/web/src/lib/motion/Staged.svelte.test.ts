import { flushSync } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import Harness from "./staged.harness.svelte";

afterEach(() => {
  vi.useRealTimers();
});

const texts = (root: Element) => [...root.querySelectorAll("p")].map((p) => p.textContent);

/** One frame: its animation callbacks, then the work they let Svelte do. */
function frame(): void {
  vi.advanceTimersByTime(16);
  flushSync();
}

test("a screen draws its skeletons first, then fills one part per frame after its own", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });

  const { container } = await render(Harness);

  expect(texts(container)).toEqual(["a waiting", "b waiting"]);
  // The first callbacks still belong to the frame that mounted the screen.
  frame();
  expect(texts(container)).toEqual(["a waiting", "b waiting"]);
  frame();
  expect(texts(container)).toEqual(["a filled", "b waiting"]);
  frame();
  expect(texts(container)).toEqual(["a filled", "b filled"]);
});
