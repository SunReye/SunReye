// Test harness: a screen's requests, counted, and counted to their end on the test's fake clock.
import { vi } from "vitest";

export { eachSeries, problem, tally } from "./core.harness.ts";

/** One turn of the page's own event loop, on no timer: a response's body is read on such turns. */
export function turn(): Promise<void> {
  const { port1, port2 } = new MessageChannel();

  const turned = new Promise<void>((resolve) => {
    port1.addEventListener("message", () => {
      resolve();
    });
  });

  port1.start();
  port2.postMessage(null);

  return turned;
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
