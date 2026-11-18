import { afterEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { LOW_POWER, MOTION_SETTING } from "./tier.ts";
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

  // A draw of 20 ms misses every other frame of a 60 Hz display and still holds the loop's 30.
  for (let frame = 0; frame < 2000; frame++) motion.frame((now += 1000 / 30));

  expect(motion.tier).toBe("full");

  // A draw of 40 ms misses the loop's own 30th of a second: the display gives 20 a second.
  for (let frame = 0; frame < 400; frame++) motion.frame((now += 50));

  expect(motion.tier).toBe("lite");
  expect(localStorage.getItem("sunreye.motion-strain")).toBe("1");
});

test("a loop's frames are no evidence while the page settles or on the still tier", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestAnimationFrame", () => 1);

  const motion = new MotionStore();
  let now = 0;

  motion.watch();

  for (let frame = 0; frame < 300; frame++) motion.frame((now += 60));

  expect(motion.tier).toBe("full");

  vi.advanceTimersByTime(4000);
  motion.lowPower = true;

  for (let frame = 0; frame < 300; frame++) motion.frame((now += 60));

  motion.lowPower = false;
  expect(motion.tier).toBe("full");
});

test("the motion setting starts on Automatisch, where the frame watch decides", () => {
  localStorage.setItem("sunreye.motion-strain", "1");
  const motion = new MotionStore();

  expect(motion.setting).toBe("auto");
  expect(motion.tier).toBe("lite");
  expect(motion.measured).toBe("lite");
});

test("Reduziert renders lite, and the choice is kept per browser", () => {
  const motion = new MotionStore();

  motion.setting = "lite";

  expect(motion.tier).toBe("lite");
  expect(localStorage.getItem(MOTION_SETTING)).toBe("lite");
  expect(new MotionStore().tier).toBe("lite");
});

test("a chosen Voll holds over a kept strain, which Automatisch still shows", () => {
  localStorage.setItem("sunreye.motion-strain", "1");
  const motion = new MotionStore();

  motion.setting = "full";

  expect(motion.tier).toBe("full");
  expect(motion.measured).toBe("lite");
});

test("a strain under a chosen Voll steps Auto's drawing down and leaves the tier", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const now = jank();
  const quality = new QualityStore();

  quality.see("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)");
  quality.show();

  const motion = new MotionStore(quality);
  motion.setting = "full";
  const release = motion.watch();

  vi.advanceTimersByTime(4000);
  await vi.waitFor(() => {
    expect(quality.look(motion.tier).level).toBe("medium");
  });
  const strained = now();

  // Mittel is as far as a strain takes the drawing on full: the watch asks for no more frames.
  vi.advanceTimersByTime(4000);
  release();

  expect(now()).toBe(strained);

  expect(motion.tier).toBe("full");
  expect(localStorage.getItem("sunreye.motion-strain")).toBeNull();
});

test("a loop's dropped frames leave a chosen tier where it is", () => {
  const motion = settled();
  let now = 3_600_000;

  motion.setting = "full";

  for (let frame = 0; frame < 400; frame++) motion.frame((now += 50));

  expect(motion.tier).toBe("full");
  motion.setting = "auto";
  expect(motion.tier).toBe("full");
});

test("Neu messen forgets the strain: the tier is full again and the watch measures anew", async () => {
  localStorage.setItem("sunreye.motion-strain", "1");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  jank();
  const motion = new MotionStore();
  const release = motion.watch();

  motion.remeasure();

  expect(motion.tier).toBe("full");
  expect(motion.measured).toBe("full");
  expect(localStorage.getItem("sunreye.motion-strain")).toBeNull();
  expect(new MotionStore().tier).toBe("full");

  vi.advanceTimersByTime(4000);
  vi.useRealTimers();
  await expect.poll(() => motion.tier).toBe("lite");
  release();
});

test("reduced motion and the low-power switch force still over a chosen tier", async () => {
  const motion = new MotionStore();

  motion.setting = "full";
  motion.lowPower = true;
  expect(motion.tier).toBe("still");

  motion.lowPower = false;
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  expect(new MotionStore().tier).toBe("still");
});

test("Neu messen also forgets the levels strain took off Auto's 3D quality", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  jank();
  const quality = new QualityStore();

  quality.see("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)");
  const hide = quality.show();
  const motion = new MotionStore(quality);
  const release = motion.watch();

  expect(motion.stepped).toBe(false);
  vi.advanceTimersByTime(4000);
  await vi.waitFor(() => {
    expect(quality.look(motion.tier).level).toBe("medium");
  });
  release();
  hide();

  // The tier was left alone: only the drawing stepped down.
  expect(motion.measured).toBe("full");
  expect(motion.stepped).toBe(true);

  motion.remeasure();

  expect(quality.look(motion.tier).level).toBe("high");
  expect(localStorage.getItem("sunreye.3d-strain")).toBeNull();
  expect(motion.stepped).toBe(false);
});

test("what holds everything still is named: the low-power switch first, then reduced motion", async () => {
  const motion = new MotionStore();

  expect(motion.held).toBeNull();

  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await expect.poll(() => motion.held).toBe("reduced");

  motion.lowPower = true;
  expect(motion.held).toBe("low-power");
});
