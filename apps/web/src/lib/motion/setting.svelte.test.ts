// The motion setting (ADR 21): Automatisch, or a chosen tier that holds; Neu messen; the off switches.
import { afterEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { jank, settled } from "./frames.harness.ts";
import { MOTION_SETTING } from "@sunreye/builder/motion/tier.ts";
import { MotionStore } from "@sunreye/builder/motion/tier.svelte.ts";
import { QualityStore } from "@sunreye/builder/scene/quality.svelte.ts";

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

test("the motion setting starts on Automatisch, where the frame watch decides", () => {
  localStorage.setItem("sunreye.motion-strain", "1");
  localStorage.setItem("sunreye.strained-at", String(Date.now()));
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
  localStorage.setItem("sunreye.strained-at", String(Date.now()));
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
  localStorage.setItem("sunreye.strained-at", String(Date.now()));
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
