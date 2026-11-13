import { flushSync } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import Harness from "./staged.harness.svelte";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const texts = (root: Element) => [...root.querySelectorAll("p")].map((p) => p.textContent);

/** One frame: its animation callbacks, then the work they let Svelte do. */
function frame(): void {
  vi.advanceTimersByTime(16);
  flushSync();
}

/** The screen, its parts costing `costs` ms each on an injected clock. */
async function show(costs: Readonly<Record<string, number>>) {
  let clock = 0;

  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  vi.spyOn(performance, "now").mockImplementation(() => clock);

  const { container } = await render(Harness, {
    onfill: (part: string) => {
      clock += costs[part] ?? 0;
    },
  });

  return container;
}

test("a screen draws its skeletons first, then fills its parts in order, as many a frame as fit", async () => {
  const container = await show({ a: 20, b: 10, c: 5 });

  expect(texts(container)).toEqual(["a waiting", "b waiting", "c waiting"]);
  // The first callbacks still belong to the frame that mounted the screen.
  frame();
  expect(texts(container)).toEqual(["a waiting", "b waiting", "c waiting"]);
  // a fits the frame's slice, so b starts; b overruns it, so c waits for the next frame.
  frame();
  expect(texts(container)).toEqual(["a filled", "b filled", "c waiting"]);
  frame();
  expect(texts(container)).toEqual(["a filled", "b filled", "c filled"]);
});

test("a part slower than a frame's slice still fills, alone in its frame", async () => {
  const container = await show({ a: 40, b: 1, c: 1 });

  frame();
  frame();
  expect(texts(container)).toEqual(["a filled", "b waiting", "c waiting"]);
  frame();
  expect(texts(container)).toEqual(["a filled", "b filled", "c filled"]);
});
