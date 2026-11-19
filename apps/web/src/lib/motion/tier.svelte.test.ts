import { afterEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { jank, settled } from "./frames.harness.ts";
import { LOW_POWER } from "./tier.ts";
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
  // Dated, so it can be forgotten in a week.
  expect(Number(localStorage.getItem("sunreye.strained-at"))).toBeGreaterThan(Date.now() - 60_000);
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

test("the idle watch does not run beside a loop, and starts over once the loop stops", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const now = jank();
  const motion = new MotionStore();
  const release = motion.watch();
  const stop = motion.loop();

  expect(motion.looping).toBe(true);
  // Settled, and long after: the loop's own frames are the evidence, and none is asked for.
  vi.advanceTimersByTime(60_000);
  expect(now()).toBe(0);

  let frame = 0;

  // A draw of 40 ms would be felt by the idle watch's 32, and holds the loop's 30 a second.
  for (let drawn = 0; drawn < 600; drawn++) motion.frame((frame += 40));

  expect(motion.tier).toBe("full");

  stop();
  expect(motion.looping).toBe(false);
  // Through the settle delay again.
  vi.advanceTimersByTime(3900);
  expect(now()).toBe(0);
  vi.advanceTimersByTime(100);
  vi.useRealTimers();

  await expect.poll(() => motion.tier).toBe("lite");
  release();
});

test("a scene being prepared is no evidence: the watch settles from its first frame", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const now = jank();
  const motion = new MotionStore();
  const release = motion.watch();
  const drawn = motion.hold();
  let frame = 0;

  // The page settled long ago; the scene still compiles, and a loop waits to draw in it.
  vi.advanceTimersByTime(30_000);

  for (let given = 0; given < 600; given++) motion.frame((frame += 60));

  expect(now()).toBe(0);
  expect(motion.tier).toBe("full");

  // The first frame is drawn: the 4 s start here.
  drawn();
  vi.advanceTimersByTime(3900);
  expect(now()).toBe(0);
  vi.advanceTimersByTime(100);
  vi.useRealTimers();

  await expect.poll(() => motion.tier).toBe("lite");
  release();
});

const DAY = 86_400_000;

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";

/** The tier and Auto's level of a browser that loads at `now`. */
function loadedAt(now: number): string {
  const quality = new QualityStore(() => now);

  quality.see(RTX);

  const motion = new MotionStore(quality, () => now);

  return `${motion.tier} ${quality.look(motion.tier).level}`;
}

test("a strain lasts seven days: then both are forgotten and the device starts from full", () => {
  localStorage.setItem("sunreye.motion-strain", "1");
  localStorage.setItem("sunreye.3d-strain", "2");
  localStorage.setItem("sunreye.strained-at", "1000");

  expect(loadedAt(1000 + 7 * DAY - 1)).toBe("lite low");
  expect(loadedAt(1000 + 7 * DAY)).toBe("full high");
});

test("a strain kept without its date, from before strains were dated, counts as that old", () => {
  localStorage.setItem("sunreye.motion-strain", "1");
  localStorage.setItem("sunreye.3d-strain", "2");

  expect(loadedAt(1000)).toBe("full high");
});

test("a strain that no longer counts is forgotten for good: a later strain cannot bring it back", () => {
  // Kept undated by an earlier version: a tier strain and two levels off Auto.
  localStorage.setItem("sunreye.motion-strain", "1");
  localStorage.setItem("sunreye.3d-strain", "2");

  const quality = new QualityStore(() => 1000);

  quality.see(RTX);
  quality.show();
  expect(new MotionStore(quality, () => 1000).tier).toBe("full");

  // One fresh strain, which dates itself: only it counts at the next load.
  quality.relieve("full");
  expect(loadedAt(2000)).toBe("full medium");
});

test("a page that never reloads forgets its strain as the seven days end, and measures anew", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  localStorage.setItem("sunreye.motion-strain", "1");
  localStorage.setItem("sunreye.strained-at", String(-6 * DAY));

  const motion = new MotionStore(new QualityStore(() => 0), () => 0);
  const release = motion.watch();

  expect(motion.tier).toBe("lite");

  vi.advanceTimersByTime(DAY - 1);
  expect(motion.tier).toBe("lite");

  vi.advanceTimersByTime(1);
  expect(motion.tier).toBe("full");
  expect(localStorage.getItem("sunreye.motion-strain")).toBeNull();
  expect(localStorage.getItem("sunreye.strained-at")).toBeNull();

  // The watch measures anew, after the settle delay.
  jank();
  vi.advanceTimersByTime(4000);
  vi.useRealTimers();
  await expect.poll(() => motion.tier).toBe("lite");
  release();
});
