// Svelte's motion shares one frame loop across a file's tests (page.setup.ts): what one test leaves
// in it must not hold a later test's tweens still (#892).
import { Tween } from "svelte/motion";
import { afterEach, expect, test } from "vitest";
import { fakeFrames, frames, realTimers } from "./clock.harness.ts";

afterEach(() => {
  realTimers();
});

test("a tween left waiting on the wall clock ends with its test", () => {
  // It begins long after the fake clock that follows has run on.
  void new Tween(0).set(1, { delay: 60_000, duration: 100 });
});

test("a test on the fake clock plays a frame of the loop that tween keeps going", async () => {
  fakeFrames();

  await frames(1);
});

test("a later tween still glides on the fake clock", async () => {
  fakeFrames();

  const tween = new Tween(0);

  void tween.set(1, { duration: 100 });
  await frames(20);

  expect(tween.current).toBe(1);
});
