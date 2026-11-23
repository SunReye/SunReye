import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Live } from "../api/core.ts";
import { stream } from "../live/stream.svelte.ts";
import { motion } from "@sunreye/builder/motion/tier.svelte.ts";
import AnimatedNumber from "./animated-number.svelte";

// Time is injected: frames and the clock move only when the test says so.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "requestAnimationFrame"] });
});

let unfollow = (): void => {};

afterEach(async () => {
  unfollow();
  motion.lowPower = false;
  // A glide left running would hold Svelte's frame loop on a fake frame.
  await vi.advanceTimersByTimeAsync(10_000);
  vi.useRealTimers();
});

/** A core whose stream the test feeds. */
function follow(): (live: Live) => void {
  const listeners: ((live: Live) => void)[] = [];

  unfollow = stream.follow({
    live: (listener) => {
      listeners.push(listener);

      return () => {};
    },
  });

  return (live) => {
    for (const listener of listeners) listener(live);
  };
}

function shown(element: Element): number {
  return Number((element.textContent ?? "").replace(",", "."));
}

async function settled(value: number) {
  const screen = await render(AnimatedNumber, { value });
  const number = screen.container.querySelector("span")!;

  await vi.advanceTimersByTimeAsync(5000);
  expect(shown(number)).toBe(value);

  return { screen, number };
}

test("a tick glides toward the new value, then lands on it", async () => {
  const { screen, number } = await settled(5);

  await screen.rerender({ value: 9 });
  await vi.advanceTimersByTimeAsync(300);

  expect(shown(number)).toBeGreaterThan(5);
  expect(shown(number)).toBeLessThan(9);

  await vi.advanceTimersByTimeAsync(5000);
  expect(shown(number)).toBe(9);
});

test("a stall stops the glide on the last reading instead of sliding on", async () => {
  const push = follow();

  push({ devices: { "1": { "pv.power": 5 } } });

  const { screen, number } = await settled(5);

  await screen.rerender({ value: 9 });
  await vi.advanceTimersByTimeAsync(300);
  expect(shown(number)).toBeLessThan(9);

  push({ devices: { "1": { "pv.power": 9 } }, lost: Date.now() });
  await vi.advanceTimersByTimeAsync(0);
  expect(shown(number)).toBe(9);

  // A reconnect's snapshot of stale values steps there too.
  push({ devices: { "1": { "pv.power": 4 } }, stale: { "1": { "pv.power": Date.now() } } });
  await screen.rerender({ value: 4 });
  expect(shown(number)).toBe(4);
});

test("low power steps to each tick", async () => {
  const { screen, number } = await settled(5);

  motion.lowPower = true;
  await screen.rerender({ value: 9 });
  expect(shown(number)).toBe(9);
});

test("no reading yet is a dash as wide as a number", async () => {
  const screen = await render(AnimatedNumber, { value: null });
  const number = screen.container.querySelector("span")!;
  const dash = number.getBoundingClientRect().width;

  await screen.rerender({ value: 0 });
  await vi.advanceTimersByTimeAsync(5000);

  expect(number.getBoundingClientRect().width).toBe(dash);
  expect(getComputedStyle(number).fontVariantNumeric).toBe("tabular-nums");
});

test("a figure that arrives with its content starts at its value and writes its own unit", async () => {
  const screen = await render(AnimatedNumber, {
    value: 7,
    format: (v: number) => `${v.toFixed(0)} %`,
    appear: false,
  });

  expect(screen.container.textContent).toBe("7 %");
});

test("a chosen glide lands on its own clock, not the tick's", async () => {
  const screen = await render(AnimatedNumber, { value: 5, duration: 320, appear: false });
  const number = screen.container.querySelector("span")!;

  await screen.rerender({ value: 9 });
  await vi.advanceTimersByTimeAsync(400);

  expect(shown(number)).toBe(9);
});

test("a placeholder stands in for the dash", async () => {
  const screen = await render(AnimatedNumber, { value: null, placeholder: "–" });

  expect(screen.container.textContent?.replaceAll(/\d|,/gu, "")).toBe("–");
});
