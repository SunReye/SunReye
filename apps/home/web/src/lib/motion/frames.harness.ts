// The frame watch's frames for the motion store's tests: every one janky, or none at all.
import { vi } from "vitest";
import { JANK_FRAME_MS } from "../../../../../../packages/builder/src/motion/tier.ts";
import { MotionStore } from "../../../../../../packages/builder/src/motion/tier.svelte.ts";

/** Every frame janky, delivered as fast as the test can run them; returns the frames' clock. */
export function jank(): () => number {
  let now = 0;

  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    now += JANK_FRAME_MS + 8;
    queueMicrotask(() => {
      frame(now);
    });

    return now;
  });

  return () => now;
}

/** A store whose own watch has settled and gets no frame of its own. */
export function settled(): MotionStore {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestAnimationFrame", () => 1);

  const motion = new MotionStore();

  motion.watch();
  vi.advanceTimersByTime(4000);

  return motion;
}
