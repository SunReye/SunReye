// A level pushed inside a drill-in level or the builder's inspector is the drill-in's push (ADR 21
// "One behaviour, one component"): it slides in over the level it leaves, back goes the other
// way, an edge-swipe follows the finger and a landed slide plays `soft`.
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { HAPTICS } from "../../haptics.ts";
import { realTimers } from "../../motion/clock.harness.ts";
import Harness from "./drill-push.harness.svelte";
import { frame, until } from "./drill-in.probe.ts";

let vibrate: ReturnType<typeof vi.fn<() => boolean>>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  localStorage.setItem(HAPTICS, "on");
});

afterEach(() => {
  realTimers();
  localStorage.removeItem(HAPTICS);
});

/** The layer showing `key`, if drawn. */
const layer = (key: string) =>
  document
    .querySelector<HTMLElement>(`[data-level="${key}"]`)
    ?.closest<HTMLElement>("[data-push]") ?? null;

/** How far a layer sits right of its place, in % of its width: 0 in place, negative shifted aside. */
function x(key: string): number | undefined {
  const transform = layer(key)?.style.transform;

  return transform === undefined
    ? undefined
    : Number(/translateX\(([-\d.]+)%\)/u.exec(transform)?.[1] ?? 0);
}

test("a deeper level slides in over the one it leaves, which shifts aside and dims; landing plays soft", async () => {
  const screen = await render(Harness);

  await screen.rerender({ at: "b" });
  await until(() => (x("b") ?? 100) < 60);

  expect(x("a")).toBeLessThan(0);
  expect(Number(layer("a")?.style.opacity)).toBeLessThan(1);
  expect(layer("a")?.inert).toBe(true);
  expect(vibrate).not.toHaveBeenCalled();

  await until(() => layer("a") === null);

  expect(x("b")).toBe(0);
  expect(vibrate).toHaveBeenCalledOnce();
});

test("back slides the level out to the right over the one above", async () => {
  const screen = await render(Harness, { at: "c" });

  await screen.rerender({ at: "b" });
  await until(() => (x("c") ?? 0) > 40);

  expect(layer("b")).not.toBeNull();

  await until(() => layer("c") === null);

  expect(x("b")).toBe(0);
});

test("a reversed slide goes on from where it is", async () => {
  const screen = await render(Harness);

  await screen.rerender({ at: "b" });
  await until(() => (x("b") ?? 100) < 60);
  const before = x("b") ?? 0;

  await screen.rerender({ at: "a" });
  await frame();

  expect(x("b")).toBeGreaterThanOrEqual(before);
  expect(x("b")).toBeLessThan(before + 20);
  await until(() => layer("b") === null);
});

/** Drags from `box`'s left edge by `dx` px in `steps` moves `ms` apart. */
async function swipe(box: Element, dx: number, steps: number, ms: number): Promise<void> {
  const { left, top } = box.getBoundingClientRect();

  const at = (px: number) => ({
    pointerId: 1,
    clientX: left + px,
    clientY: top + 20,
    bubbles: true,
  });

  const target = box.querySelector("p") ?? box;

  target.dispatchEvent(new PointerEvent("pointerdown", at(4)));

  for (let i = 1; i <= steps; i++) {
    vi.advanceTimersByTime(ms);
    target.dispatchEvent(new PointerEvent("pointermove", at(4 + (dx * i) / steps)));
  }

  await tick();
  target.dispatchEvent(new PointerEvent("pointerup", at(4 + dx)));
}

test("an edge-swipe past halfway goes back; one let go early springs the level back", async () => {
  await render(Harness, { at: "b" });

  await swipe(layer("b")!, 80, 8, 30);
  await until(() => layer("a") === null && x("b") === 0);

  await swipe(layer("b")!, 260, 8, 16);
  await until(() => layer("b") === null);

  expect(x("a")).toBe(0);
});

test("a swipe on a push inside a pushed level goes back one level", async () => {
  const screen = await render(Harness, { at: "b", nested: true });

  await screen.rerender({ inner: "y" });
  await until(() => layer("x") === null);

  await swipe(layer("y")!, 260, 8, 16);
  await until(() => layer("y") === null);

  expect(layer("x")).not.toBeNull();
  expect(layer("b")).not.toBeNull();
  expect(layer("a")).toBeNull();
});
