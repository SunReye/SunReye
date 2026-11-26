// Test harness: a screen's requests counted to their end on the test's fake clock, the 3D scene's
// among them.
import { vi } from "vitest";
import { realTimers } from "../lib/motion/clock.harness.ts";
import { warm } from "../../../../../packages/builder/src/scene/warm.ts";

export { eachSeries, problem, settled, tally } from "../lib/api/settled.harness.ts";

/** One thing the fake clock fakes. */
type Faked = NonNullable<NonNullable<Parameters<typeof vi.useFakeTimers>[0]>["toFake"]>[number];

/**
 * The screens' timers, frames and idle tasks on the fake clock, which `settled` runs on, and
 * `more` beside them: the scene's reads start a frame and an idle task after the dashboard shows.
 */
export function fakeClock(more: readonly Faked[] = [], now = Date.now()): void {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      ...more,
    ],
    now,
  });
}

/** Back on the wall clock, the fake frames played out. */
export const restoreClock = realTimers;

/** The scene mounts, and reads, once the warm-up worker has answered. */
export async function sceneMayMount(): Promise<void> {
  await warm().webgl2;
}
