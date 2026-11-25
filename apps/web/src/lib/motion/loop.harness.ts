// Test harness: Svelte's motion shares one frame loop, which runs while it holds a task and is
// reached by no public API. The last test's tweens stay in it unmounted: one begun on the wall
// clock waits out a fake clock that starts at zero, and its frame, dropped with the fake clock,
// holds every later tween still (#892).
// eslint-disable-next-line svelte/no-svelte-internal -- the loop's tasks, emptied between tests only.
import { raf } from "svelte/internal/client";

/** Empties Svelte's frame loop: for `page.setup.ts`, once the last test's screen is unmounted. */
export function emptyFrameLoop(): void {
  raf.tasks.clear();
}
