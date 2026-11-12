import { afterEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { LOW_POWER } from "../live/dashboard.ts";
import { JANK_FRAME_MS } from "./tier.ts";
import { MotionStore } from "./tier.svelte.ts";

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

test("a device starts on full", () => {
  expect(new MotionStore().tier).toBe("full");
});

test("the low-power switch forces still, kept or flipped", () => {
  localStorage.setItem(LOW_POWER, "on");
  expect(new MotionStore().tier).toBe("still");

  localStorage.removeItem(LOW_POWER);
  const motion = new MotionStore();
  motion.lowPower = true;
  expect(motion.tier).toBe("still");
  expect(motion.still).toBe(true);
});

test("reduced motion forces still", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  expect(new MotionStore().tier).toBe("still");
});

test("a strain the frame watch records survives a reload and starts the device on lite", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let now = 0;
  // Every frame janky, delivered as fast as the test can run them.
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    now += JANK_FRAME_MS + 8;
    queueMicrotask(() => {
      frame(now);
    });

    return now;
  });

  const motion = new MotionStore();
  const release = motion.watch();
  // The watch waits for the page to settle.
  vi.advanceTimersByTime(3900);
  expect(now).toBe(0);
  vi.advanceTimersByTime(100);
  vi.useRealTimers();

  await expect.poll(() => motion.tier).toBe("lite");
  release();

  expect(new MotionStore().tier).toBe("lite");
});
