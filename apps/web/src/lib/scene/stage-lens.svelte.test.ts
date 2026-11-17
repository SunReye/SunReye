import { flushSync } from "svelte";
import { afterEach, expect, test } from "vitest";
import { motion } from "../motion/tier.svelte.ts";
import { quality } from "./quality.svelte.ts";
import { draws, DROPS, FROST, onLens, open, shut } from "./stage.harness.svelte.ts";

// The weather loop under the lens glass (ADR 23 "Motion"): it runs while the glass moves or
// fades, and not for frost that stands.

afterEach(shut);

test("the scene loops while rain is on the lens, fades it out once the weather clears, and stops", async () => {
  const { loop, drawn, glazed, lens } = await open();

  lens(DROPS);
  expect(loop.running).toBe(true);
  // It fades in by the loop's frames, and runs on.
  await expect.poll(() => onLens(glazed), { timeout: 30_000 }).toEqual(DROPS);
  expect(loop.running).toBe(true);
  expect(await draws(drawn)).toBeGreaterThan(0);

  lens(null);
  // Still fading: the loop goes on without the weather.
  expect(loop.running).toBe(true);
  await expect.poll(() => loop.running, { timeout: 30_000 }).toBe(false);
  expect(onLens(glazed)).toBeNull();
  expect(await draws(drawn)).toBe(0);
}, 90_000);

test("frost on a dry day loops while it fades in and out, and stands drawn in between", async () => {
  const { loop, drawn, glazed, lens } = await open();

  lens(FROST);
  expect(loop.running).toBe(true);
  // Faded in, nothing moves: the loop stops and the frost stays on the lens.
  await expect.poll(() => loop.running, { timeout: 30_000 }).toBe(false);
  expect(onLens(glazed)).toEqual(FROST);
  expect(await draws(drawn)).toBe(0);
  expect(onLens(glazed)).toEqual(FROST);

  lens(null);
  expect(loop.running).toBe(true);
  await expect.poll(() => loop.running, { timeout: 30_000 }).toBe(false);
  expect(onLens(glazed)).toBeNull();
  expect(await draws(drawn)).toBe(0);
}, 90_000);

test("Niedrig puts nothing on the lens and loops for none of it", async () => {
  const { loop, glazed, lens } = await open();

  quality.choice = "low";
  flushSync();
  lens(FROST);
  expect(loop.running).toBe(false);
  expect(glazed).not.toHaveBeenCalled();

  quality.choice = "medium";
  flushSync();
  expect(loop.running).toBe(true);
});

test("still clears the lens at once and never loops for it", async () => {
  const { loop, glazed, lens } = await open();

  lens(DROPS);
  await expect.poll(() => onLens(glazed), { timeout: 30_000 }).toEqual(DROPS);

  motion.lowPower = true;
  flushSync();
  expect(onLens(glazed)).toBeNull();
  expect(loop.running).toBe(false);

  motion.lowPower = false;
  flushSync();
  expect(loop.running).toBe(true);
}, 60_000);

test("still clears standing frost too, and full fades it in again", async () => {
  const { loop, glazed, lens } = await open();

  lens(FROST);
  await expect.poll(() => loop.running, { timeout: 30_000 }).toBe(false);

  motion.lowPower = true;
  flushSync();
  expect(onLens(glazed)).toBeNull();

  motion.lowPower = false;
  flushSync();
  expect(loop.running).toBe(true);
  await expect.poll(() => loop.running, { timeout: 30_000 }).toBe(false);
  expect(onLens(glazed)).toEqual(FROST);
}, 90_000);
