import { flushSync } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { motion } from "../motion/tier.svelte.ts";
import { draws, open, RAIN, shut } from "./stage.harness.svelte.ts";

// The weather loop under what falls (ADR 23 "Motion").

afterEach(shut);

function hide(hidden: boolean): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(hidden ? "hidden" : "visible");
  document.dispatchEvent(new Event("visibilitychange"));
}

test("the scene loops while rain falls and stops when the weather turns dry", async () => {
  const { loop, drawn, fell, counted, seen, weather } = await open();

  expect(loop.running).toBe(false);
  expect(await draws(drawn)).toBe(0);

  weather(RAIN);
  expect(loop.running).toBe(true);
  expect(fell.mock.lastCall).toEqual([RAIN, false]);

  const labels = seen.labels;

  expect(await draws(drawn)).toBeGreaterThan(0);
  // The frame watch counts its frames; the labels are placed for a changed picture alone.
  expect(counted).toHaveBeenCalled();
  expect(seen.labels - labels).toBeLessThanOrEqual(1);

  weather(null);
  expect(loop.running).toBe(false);
  expect(fell.mock.lastCall).toEqual([null, false]);
  expect(await draws(drawn)).toBe(0);
});

test("the loop pauses while the tab is hidden or the canvas is off screen", async () => {
  const { canvas, loop, drawn, weather } = await open();

  weather(RAIN);
  hide(true);
  expect(loop.running).toBe(false);
  expect(await draws(drawn)).toBe(0);

  hide(false);
  expect(loop.running).toBe(true);

  // Scrolled away.
  canvas.style.marginTop = "300vh";
  await expect.poll(() => loop.running).toBe(false);
  expect(await draws(drawn)).toBe(0);

  canvas.style.marginTop = "0";
  await expect.poll(() => loop.running).toBe(true);
  expect(await draws(drawn)).toBeGreaterThan(0);
});

test("a second keeper holds the loop through dry weather, until it lets go", async () => {
  const { loop, drawn, weather } = await open();
  const glass = loop.keep(() => {});

  expect(loop.running).toBe(true);
  weather(RAIN);
  weather(null);
  expect(loop.running).toBe(true);
  expect(await draws(drawn)).toBeGreaterThan(0);

  glass();
  expect(loop.running).toBe(false);
});

test("still draws nothing that falls and never loops", async () => {
  const { loop, fell, weather } = await open();

  weather(RAIN);
  motion.lowPower = true;
  flushSync();
  expect(fell.mock.lastCall).toEqual([null, false]);
  expect(loop.running).toBe(false);

  // Not even for a second keeper: the loop is the full tier's.
  const glass = loop.keep(() => {});

  expect(loop.running).toBe(false);
  glass();

  motion.lowPower = false;
  flushSync();
  expect(fell.mock.lastCall).toEqual([RAIN, false]);
  expect(loop.running).toBe(true);
});
