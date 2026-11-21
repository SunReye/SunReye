// Test harness: the frames and clock a spring, a tween or a finger's speed reads (`animate.ts`), on
// the test's fake clock, which only the test moves on.
import { tick } from "svelte";
import { expect, vi } from "vitest";
import { turn } from "../api/settled.harness.ts";

/** How many steps a wait takes at most: counted, never timed, so a page under load gets as many. */
const STEPS = 1000;

/**
 * Takes `step` until `done` holds, the page taking its own turn after each, so an event a step
 * leads to lands as it would. Fails after `STEPS` steps.
 */
export async function until(done: () => boolean, step: () => void | Promise<void>): Promise<void> {
  for (let i = 0; i < STEPS && !done(); i++) {
    // oxlint-disable-next-line no-await-in-loop -- one step after another.
    await step();
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await turn();
  }

  expect(done(), `not done after ${STEPS} steps`).toBe(true);
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
  await until(done, () => {
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
