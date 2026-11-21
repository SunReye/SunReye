// Test harness: the frames and clock a spring, a tween or a finger's speed reads (`animate.ts`), on
// the test's fake clock, which only the test moves on; and what the browser does only on a frame
// it draws (a frame callback, a size or an element on screen observed), done by the test when it
// waits on it.
import { tick } from "svelte";
import { vi } from "vitest";
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
 * ones. On the fake clock (`requestAnimationFrame` faked), its next frame instead.
 */
export function playFrame(): void {
  resized();
  scrolled();

  if (framesFaked()) vi.advanceTimersToNextFrame();
  else runFrameCallbacks();

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
  for (let i = 0; i < count; i++) vi.advanceTimersToNextFrame();

  await tick();
}

/**
 * Plays frames on the fake clock (`requestAnimationFrame` faked) until `done` holds. The page gets its own turn between frames, so
 * an event the frames wait on (a route's `popstate`) lands as it would.
 */
export async function framesUntil(done: () => boolean): Promise<void> {
  await stepUntil(done, () => {
    vi.advanceTimersToNextFrame();
  });
}

/**
 * Back on the wall clock once the fake frames have played out. Svelte's motion shares one frame
 * loop: a frame it waits on, dropped with the fake clock, would hold every later tween still.
 */
export function realTimers(): void {
  if (vi.isFakeTimers()) vi.advanceTimersByTime(10_000);

  vi.useRealTimers();
}
