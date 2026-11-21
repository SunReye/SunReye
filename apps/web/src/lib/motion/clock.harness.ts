// Test harness: the frames and clock a spring, a tween or a finger's speed reads (`animate.ts`), on
// the test's fake clock, which only the test moves on; and what the browser does only on a frame
// it draws (a frame callback, a size or an element on screen observed), done by the test when it
// waits on it.
import { tick } from "svelte";
import { expect, vi } from "vitest";
import type { Locator } from "vitest/browser";
import { turn } from "../api/settled.harness.ts";
import {
  framesFaked,
  runFrameCallbacks,
  runIdleCallbacks,
  watchCallbacks,
} from "./callbacks.harness.ts";
import { scrolled, watchScreen } from "./onscreen.harness.ts";
import { resized, watchSizes } from "./sizes.harness.ts";

/**
 * Puts the page's frame and idle callbacks and its size and on-screen observers where the harness
 * reaches them, for every test (`page.setup.ts`): the browser still runs them, and `playFrame`
 * runs them first when a test waits on them.
 */
export function watchFrames(): void {
  watchCallbacks();
  watchSizes();
  watchScreen();
}

/**
 * Does what the browser does on its next frame and in the idle time after it, now: tells its size
 * and on-screen observers what changed, runs the frame callbacks asked for so far, then the idle
 * ones. On the fake clock (`requestAnimationFrame` faked), its next frame too; frames a test
 * stands in for itself, off the fake clock, are left to it.
 */
export function playFrame(): void {
  resized();
  scrolled();
  // Asked for before the clock was faked, they would wait for the real one: Svelte's frame loop,
  // asked once, would hold every tween after it still.
  runFrameCallbacks();

  if (framesFaked() && vi.isFakeTimers()) vi.advanceTimersToNextFrame();

  runIdleCallbacks();
}

/**
 * Until `done` holds, does what the page waits on a frame for, again on each look. No deadline of
 * its own, and no frame of the browser's.
 */
export async function settle(done: () => boolean): Promise<void> {
  await stepUntil(done, playFrame);
}

/**
 * Takes `step` until `done` holds, the page taking its own turn after each, so an event a step
 * leads to lands as it would. No deadline of its own: a page under load takes as long as it takes,
 * and a wait that never ends fails on the test's own timeout.
 */
export async function stepUntil(
  done: () => boolean,
  step: () => void | Promise<void>,
): Promise<void> {
  while (!done()) {
    // oxlint-disable-next-line no-await-in-loop -- one step after another.
    await step();
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await turn();
  }
}

/** Plays `count` frames on the fake clock (`requestAnimationFrame` faked), their updates drawn. */
export async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) playFrame();

  await tick();
}

/**
 * Plays frames on the fake clock (`requestAnimationFrame` faked) until `done` holds. The page gets its own turn between frames, so
 * an event the frames wait on (a route's `popstate`) lands as it would.
 */
export async function framesUntil(done: () => boolean): Promise<void> {
  await settle(done);
}

/** Puts the page's frames on the fake clock: a tween or a spring moves as the test plays them. */
export function fakeFrames(): void {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
}

/** Until what `locator` finds is on the page, what it waits a frame for done on the test's step;
 * then that it shows. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- vitest's locator, only read.
export async function appears(locator: Locator): Promise<void> {
  await settle(() => locator.query() !== null);
  await expect.element(locator).toBeVisible();
}

/**
 * Back on the wall clock once the fake frames have played out. Svelte's motion shares one frame
 * loop: a frame it waits on, dropped with the fake clock, would hold every later tween still.
 */
export function realTimers(): void {
  if (vi.isFakeTimers()) vi.advanceTimersByTime(10_000);

  vi.useRealTimers();
}
