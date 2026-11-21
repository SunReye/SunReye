// Test harness: a screen's requests, counted, and counted to their end on the test's fake clock.
import { vi } from "vitest";

export { eachSeries, problem, tally } from "./core.harness.ts";

/**
 * One turn of the page's own event loop, on no timer, after all it has queued: a response's body
 * is read on such turns, and work the page put off till it is idle runs before it.
 */
export function turn(): Promise<void> {
  return scheduler.postTask(() => {}, { priority: "background" });
}

/**
 * Resolves once `count` has held still for three rounds, each the test's fake clock (`setTimeout`
 * faked) running on by `ms` and the page taking a few turns: a screen has made every request it
 * will, its own timers' too.
 */
export async function settled(count: () => number, ms = 600, still = 0): Promise<void> {
  const last = count();

  await vi.advanceTimersByTimeAsync(ms);

  for (let i = 0; i < 5; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one turn after another.
    await turn();
  }

  if (count() !== last) await settled(count, ms, 0);
  else if (still < 2) await settled(count, ms, still + 1);
}
