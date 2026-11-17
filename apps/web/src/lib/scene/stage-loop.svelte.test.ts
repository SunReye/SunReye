import { flushSync } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { motion } from "../motion/tier.svelte.ts";
import { quality } from "./quality.svelte.ts";
import { lit, type Lit, type Sky } from "./stage.svelte.ts";
import { Studio } from "./studio.ts";
import { DRY, type Falling, type Glass } from "./weather.ts";

const RAIN: Falling = { kind: "rain", density: 1, wind: [2, 0] };

const FROST: Glass = { rain: 0, snow: 0, frost: 1 };

const noop = (): void => {};

let close: (() => void) | undefined;

afterEach(() => {
  close?.();
  close = undefined;
  quality.choice = "auto";
  vi.restoreAllMocks();
  localStorage.clear();
});

/** What the studio is asked for, and the frames counted. */
function watched() {
  return {
    // This host draws in software: its frames are no evidence, and none may strain a later test.
    counted: vi.spyOn(motion, "frame").mockImplementation(() => {}),
    drawn: vi.spyOn(Studio.prototype, "render"),
    fell: vi.spyOn(Studio.prototype, "fall"),
    glazed: vi.spyOn(Studio.prototype, "lens"),
  };
}

/** A lit studio on a canvas on screen, opened, under a weather the test sets. */
async function open() {
  const canvas = document.createElement("canvas");
  let falling = $state.raw<Falling | null>(null);
  let glass = $state.raw<Glass | null>(null);
  let scene: Lit | undefined;
  const seen = { labels: 0 };
  const asked = watched();

  canvas.style.cssText = "display: block; width: 64px; height: 64px";
  document.body.append(canvas);

  const unmount = $effect.root(() => {
    scene = lit(
      canvas,
      new PerspectiveCamera(40, 1, 0.1, 5000),
      (): Sky => ({ sun: null, diffuse: null, weather: { ...DRY, falling, glass } }),
      () => {
        seen.labels += 1;
      },
    );
    scene.studio.setSize(64, 64);
  });

  close = () => {
    scene?.dispose();
    unmount();
    canvas.remove();
  };

  if (scene === undefined) throw new TypeError("no scene");

  await scene.opening.open(Promise.resolve(), noop, noop);

  return {
    canvas,
    loop: scene.loop,
    seen,
    ...asked,
    weather: (next: Falling | null): void => {
      falling = next;
      flushSync();
    },
    lens: (next: Glass | null): void => {
      glass = next;
      flushSync();
    },
  };
}

/** `count` of the display's frames, one after the other. */
async function frames(count: number): Promise<void> {
  if (count === 0) return;

  await new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
  await frames(count - 1);
}

/** How often the studio draws on its own over eight frames, once what was asked for is drawn. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a spy, only read.
async function draws(drawn: { readonly mock: { readonly calls: readonly unknown[] } }) {
  await frames(4);

  const before = drawn.mock.calls.length;

  await frames(8);

  return drawn.mock.calls.length - before;
}

function hide(hidden: boolean): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(hidden ? "hidden" : "visible");
  document.dispatchEvent(new Event("visibilitychange"));
}

test("the scene loops while rain falls and stops when the weather turns dry", async () => {
  const { loop, drawn, fell, counted, seen, weather } = await open();

  expect(loop.running).toBe(false);
  expect(await draws(drawn)).toBe(0);

  weather(RAIN);
  expect(loop.running).toBe(true);
  expect(fell.mock.lastCall).toEqual([RAIN, false]);

  const labels = seen.labels;

  expect(await draws(drawn)).toBeGreaterThan(0);
  // The frame watch counts its frames; the labels are placed for a changed picture alone.
  expect(counted).toHaveBeenCalled();
  expect(seen.labels - labels).toBeLessThanOrEqual(1);

  weather(null);
  expect(loop.running).toBe(false);
  expect(fell.mock.lastCall).toEqual([null, false]);
  expect(await draws(drawn)).toBe(0);
});

test("the loop pauses while the tab is hidden or the canvas is off screen", async () => {
  const { canvas, loop, drawn, weather } = await open();

  weather(RAIN);
  hide(true);
  expect(loop.running).toBe(false);
  expect(await draws(drawn)).toBe(0);

  hide(false);
  expect(loop.running).toBe(true);

  // Scrolled away.
  canvas.style.marginTop = "300vh";
  await expect.poll(() => loop.running).toBe(false);
  expect(await draws(drawn)).toBe(0);

  canvas.style.marginTop = "0";
  await expect.poll(() => loop.running).toBe(true);
  expect(await draws(drawn)).toBeGreaterThan(0);
});

test("a second keeper holds the loop through dry weather, until it lets go", async () => {
  const { loop, drawn, weather } = await open();
  const glass = loop.keep(() => {});

  expect(loop.running).toBe(true);
  weather(RAIN);
  weather(null);
  expect(loop.running).toBe(true);
  expect(await draws(drawn)).toBeGreaterThan(0);

  glass();
  expect(loop.running).toBe(false);
});

test("still draws nothing that falls and never loops", async () => {
  const { loop, fell, weather } = await open();

  weather(RAIN);
  motion.lowPower = true;
  flushSync();
  expect(fell.mock.lastCall).toEqual([null, false]);
  expect(loop.running).toBe(false);

  // Not even for a second keeper: the loop is the full tier's.
  const glass = loop.keep(() => {});

  expect(loop.running).toBe(false);
  glass();

  motion.lowPower = false;
  flushSync();
  expect(fell.mock.lastCall).toEqual([RAIN, false]);
  expect(loop.running).toBe(true);
});

/** What was last put on the lens. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a spy, only read.
const onLens = (glazed: ReturnType<typeof watched>["glazed"]): Glass | null | undefined =>
  glazed.mock.lastCall?.[0];

test("the scene loops while something is on the lens, fades it out once the weather clears, and stops", async () => {
  const { loop, drawn, glazed, lens } = await open();

  lens(FROST);
  expect(loop.running).toBe(true);
  // It fades in by the loop's frames.
  await expect.poll(() => onLens(glazed), { timeout: 30_000 }).toEqual(FROST);

  lens(null);
  // Still fading: the loop goes on without the weather.
  expect(loop.running).toBe(true);
  await expect.poll(() => loop.running, { timeout: 30_000 }).toBe(false);
  expect(onLens(glazed)).toBeNull();
  expect(await draws(drawn)).toBe(0);
}, 90_000);

test("Niedrig puts nothing on the lens and loops for none of it", async () => {
  const { loop, glazed, lens } = await open();

  quality.choice = "low";
  flushSync();
  lens(FROST);
  expect(loop.running).toBe(false);
  expect(glazed).not.toHaveBeenCalled();

  quality.choice = "medium";
  flushSync();
  expect(loop.running).toBe(true);
});

test("still clears the lens at once and never loops for it", async () => {
  const { loop, glazed, lens } = await open();

  lens(FROST);
  await expect.poll(() => onLens(glazed), { timeout: 30_000 }).toEqual(FROST);

  motion.lowPower = true;
  flushSync();
  expect(onLens(glazed)).toBeNull();
  expect(loop.running).toBe(false);

  motion.lowPower = false;
  flushSync();
  expect(loop.running).toBe(true);
}, 60_000);
