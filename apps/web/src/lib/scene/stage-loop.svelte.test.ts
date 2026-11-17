import { flushSync } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { motion } from "../motion/tier.svelte.ts";
import { lit, type Lit, type Sky } from "./stage.svelte.ts";
import { Studio } from "./studio.ts";
import { DRY, type Falling } from "./weather.ts";

const RAIN: Falling = { kind: "rain", density: 1, wind: [2, 0] };

const noop = (): void => {};

let close: (() => void) | undefined;

afterEach(() => {
  close?.();
  close = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
});

/** A lit studio on a canvas on screen, opened, under a weather the test sets. */
async function open() {
  const canvas = document.createElement("canvas");
  let falling = $state.raw<Falling | null>(null);
  let scene: Lit | undefined;
  const seen = { labels: 0 };
  // This host draws in software: its frames are no evidence, and none may strain a later test.
  const counted = vi.spyOn(motion, "frame").mockImplementation(() => {});
  const drawn = vi.spyOn(Studio.prototype, "render");
  const fell = vi.spyOn(Studio.prototype, "fall");

  canvas.style.cssText = "display: block; width: 64px; height: 64px";
  document.body.append(canvas);

  const unmount = $effect.root(() => {
    scene = lit(
      canvas,
      new PerspectiveCamera(40, 1, 0.1, 5000),
      (): Sky => ({ sun: null, diffuse: null, weather: { ...DRY, falling } }),
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
    counted,
    drawn,
    fell,
    weather: (next: Falling | null): void => {
      falling = next;
      flushSync();
    },
  };
}

/** Whether the studio draws on its own over the next frames. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a spy, only read.
async function draws(drawn: { readonly mock: { readonly calls: readonly unknown[] } }) {
  await new Promise((resolve) => {
    setTimeout(resolve, 150);
  });

  const before = drawn.mock.calls.length;

  await new Promise((resolve) => {
    setTimeout(resolve, 250);
  });

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

  // At most 30 a second, whatever this host's display gives.
  const looped = await draws(drawn);

  expect(looped).toBeGreaterThan(0);
  expect(looped).toBeLessThanOrEqual(9);
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
