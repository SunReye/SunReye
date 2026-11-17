import { afterEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { LOW_POWER } from "./tier.ts";
import { JANK_FRAME_MS } from "./tier.ts";
import { MotionStore } from "./tier.svelte.ts";
import { QualityStore } from "../scene/quality.svelte.ts";

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

test("the low-power switch is kept per browser", () => {
  const motion = new MotionStore();

  motion.lowPower = true;
  expect(localStorage.getItem(LOW_POWER)).toBe("on");
  expect(new MotionStore().lowPower).toBe(true);

  motion.lowPower = false;
  expect(localStorage.getItem(LOW_POWER)).toBe("off");
});

test("reduced motion forces still", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  expect(new MotionStore().tier).toBe("still");
});

/** Every frame janky, delivered as fast as the test can run them; returns the frames' clock. */
function jank(): () => number {
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

test("a strain the frame watch records survives a reload and starts the device on lite", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const now = jank();
  const motion = new MotionStore();
  const release = motion.watch();
  // The watch waits for the page to settle.
  vi.advanceTimersByTime(3900);
  expect(now()).toBe(0);
  vi.advanceTimersByTime(100);
  vi.useRealTimers();

  await expect.poll(() => motion.tier).toBe("lite");
  release();

  expect(new MotionStore().tier).toBe("lite");
});

test("a strain over a scene drawn on Auto's Hoch lowers the drawing first, then the tier, then the drawing again", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  jank();
  const quality = new QualityStore();

  quality.see("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)");
  quality.show();

  const motion = new MotionStore(quality);
  const release = motion.watch();
  const levels = [`${motion.tier} ${quality.look(motion.tier).level}`];

  // Each strain is judged after the page has settled again.
  for (let strain = 0; strain < 3; strain++) {
    vi.advanceTimersByTime(4000);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one strain after the other.
    await vi.waitFor(() => {
      expect(`${motion.tier} ${quality.look(motion.tier).level}`).not.toBe(levels.at(-1));
    });
    levels.push(`${motion.tier} ${quality.look(motion.tier).level}`);
  }

  release();

  expect(levels).toEqual(["full high", "full medium", "lite medium", "lite low"]);
});

/** A store whose own watch has settled and gets no frame of its own. */
function settled(): MotionStore {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestAnimationFrame", () => 1);

  const motion = new MotionStore();

  motion.watch();
  vi.advanceTimersByTime(4000);

  return motion;
}

test("a loop's frames are judged for as long as it runs: held ones leave the tier, dropped ones lower it", () => {
  const motion = settled();
  // An hour on, long after the watch's own windows.
  let now = 3_600_000;

  for (let frame = 0; frame < 2000; frame++) motion.frame((now += 1000 / 60));

  expect(motion.tier).toBe("full");

  // Every other frame dropped: the loop's draw takes longer than its 30th of a second.
  for (let frame = 0; frame < 400; frame++) motion.frame((now += frame % 2 === 0 ? 40 : 8));

  expect(motion.tier).toBe("lite");
  expect(localStorage.getItem("sunreye.motion-strain")).toBe("1");
});

test("a loop's frames are no evidence while the page settles or on the still tier", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestAnimationFrame", () => 1);

  const motion = new MotionStore();
  let now = 0;

  motion.watch();

  for (let frame = 0; frame < 300; frame++) motion.frame((now += 40));

  expect(motion.tier).toBe("full");

  vi.advanceTimersByTime(4000);
  motion.lowPower = true;

  for (let frame = 0; frame < 300; frame++) motion.frame((now += 40));

  motion.lowPower = false;
  expect(motion.tier).toBe("full");
});
