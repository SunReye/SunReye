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
  const { looping, drawn, fell, counted, seen, weather } = await open();

  expect(await looping()).toBe(false);
  expect(await draws(drawn)).toBe(0);

  weather(RAIN);
  expect(await looping()).toBe(true);
  expect(fell.mock.lastCall).toEqual([RAIN, false]);

  const labels = seen.labels;

  expect(await draws(drawn)).toBeGreaterThan(0);
  // The frame watch counts its frames; the labels are placed for a changed picture alone.
  expect(counted).toHaveBeenCalled();
  expect(seen.labels - labels).toBeLessThanOrEqual(1);

  weather(null);
  expect(await looping()).toBe(false);
  expect(fell.mock.lastCall).toEqual([null, false]);
  expect(await draws(drawn)).toBe(0);
});

test("the loop pauses while the tab is hidden or the canvas is off screen", async () => {
  const { canvas, looping, drawn, weather } = await open();

  weather(RAIN);
  hide(true);
  expect(await looping()).toBe(false);
  expect(await draws(drawn)).toBe(0);

  hide(false);
  expect(await looping()).toBe(true);

  // Scrolled away.
  canvas.style.marginTop = "300vh";
  await expect.poll(looping, { timeout: 10_000 }).toBe(false);
  expect(await draws(drawn)).toBe(0);

  canvas.style.marginTop = "0";
  await expect.poll(looping, { timeout: 10_000 }).toBe(true);
  expect(await draws(drawn)).toBeGreaterThan(0);
});

test("still draws nothing that falls and never loops", async () => {
  const { looping, fell, weather } = await open();

  weather(RAIN);
  motion.lowPower = true;
  flushSync();
  expect(fell.mock.lastCall).toEqual([null, false]);
  expect(await looping()).toBe(false);

  motion.lowPower = false;
  flushSync();
  expect(fell.mock.lastCall).toEqual([RAIN, false]);
  expect(await looping()).toBe(true);
});
