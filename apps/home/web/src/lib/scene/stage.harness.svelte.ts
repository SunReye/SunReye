// Shared by the lit studio's component tests: a studio opened under a weather the test sets,
// what it is asked for, and how often it draws on its own.
import { flushSync } from "svelte";
import { vi } from "vitest";
import { PerspectiveCamera } from "three";
import { frames, framesUntil, stepUntil } from "../motion/clock.harness.ts";
import { motion } from "../../../../../../packages/builder/src/motion/tier.svelte.ts";
import { weatherEffects } from "../../../../../../packages/builder/src/scene/weather-effects.svelte.ts";
import { quality } from "../../../../../../packages/builder/src/scene/quality.svelte.ts";
import {
  lit,
  type Lit,
  type Sky,
} from "../../../../../../packages/builder/src/scene/stage.svelte.ts";
import { Studio } from "../../../../../../packages/builder/src/scene/studio.ts";
import {
  DRY,
  type Falling,
  type Glass,
  type SceneWeather,
} from "../../../../../../packages/builder/src/scene/weather.ts";

export const RAIN: Falling = { kind: "rain", density: 1, wind: [2, 0] };

export const FROST: Glass = { rain: 0, snow: 0, frost: 1 };

export const DROPS: Glass = { rain: 1, snow: 0, frost: 0 };

const noop = (): void => {};

let close: (() => void) | undefined;

/** Closes the studio opened and puts this browser's switches back: after each test. */
export function shut(): void {
  vi.useRealTimers();
  close?.();
  close = undefined;
  quality.choice = "auto";
  weatherEffects.on = true;
  vi.restoreAllMocks();
  localStorage.clear();
}

/** What the studio is asked for, and the frames counted, on frames the test plays. */
function watched() {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });

  return {
    // This host draws in software: its frames are no evidence, and none may strain a later test.
    counted: vi.spyOn(motion, "frame").mockImplementation(() => {}),
    drawn: vi.spyOn(Studio.prototype, "render"),
    fell: vi.spyOn(Studio.prototype, "fall"),
    glazed: vi.spyOn(Studio.prototype, "lens"),
    lighted: vi.spyOn(Studio.prototype, "light"),
  };
}

function onScreen(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  canvas.style.cssText = "display: block; width: 64px; height: 64px";
  document.body.append(canvas);

  return canvas;
}

/** Opens `scene` once `built`, on the frames played until its first is drawn. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the scene opens in place.
async function opened(scene: Lit, built: Readonly<Promise<void>>): Promise<void> {
  let done = false;

  const opening = scene.opening.open(built, noop, noop).then(() => {
    done = true;

    return done;
  });

  await framesUntil(() => done);
  await opening;
}

/** A lit studio on a canvas on screen, opened once `built`, under a weather the test sets. */
export async function open(built: Readonly<Promise<void>> = Promise.resolve()) {
  const canvas = onScreen();
  let weather = $state.raw(DRY);
  let scene: Lit | undefined;
  const seen = { labels: 0 };
  const asked = watched();

  const sky = (): Sky => ({ sun: null, diffuse: null, weather });

  const label = (): void => {
    seen.labels += 1;
  };

  const unmount = $effect.root(() => {
    scene = lit(canvas, new PerspectiveCamera(40, 1, 0.1, 5000), sky, label);
    scene.studio.setSize(64, 64);
  });

  close = () => {
    scene?.dispose();
    unmount();
    canvas.remove();
  };

  if (scene === undefined) throw new TypeError("no scene");

  await opened(scene, built);

  /** The weather turns to what it was but for `next`. */
  const turn = (next: Partial<SceneWeather>): void => {
    weather = { ...weather, ...next };
    flushSync();
  };

  return {
    canvas,
    scene,
    /** Whether the weather loop runs: the studio draws on its own. */
    looping: async (): Promise<boolean> => (await draws(asked.drawn)) > 0,
    seen,
    ...asked,
    weather: (falling: Falling | null): void => {
      turn({ falling });
    },
    lens: (glass: Glass | null): void => {
      turn({ glass });
    },
    under: turn,
  };
}

/** How often the studio draws on its own over eight frames, once what was asked for is drawn. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a spy, only read.
export async function draws(drawn: { readonly mock: { readonly calls: readonly unknown[] } }) {
  await frames(4);

  const before = drawn.mock.calls.length;

  await frames(8);

  return drawn.mock.calls.length - before;
}

/** What was last put on the lens. */
export const onLens = (
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a spy, only read.
  glazed: Awaited<ReturnType<typeof open>>["glazed"],
): Glass | null | undefined => glazed.mock.lastCall?.[0];

/** Until `check` holds, as many frames as it plays, however long they take to draw: what fades
 * runs out on the frames played. */
export async function playedUntil(check: () => Promise<boolean>): Promise<void> {
  let held = await check();

  await stepUntil(
    () => held,
    async () => {
      held = await check();
    },
  );
}

/** Whether the lens holds `glass` at full strength. */
export const holds = (on: Glass | null | undefined, glass: Glass): boolean =>
  on?.rain === glass.rain && on.snow === glass.snow && on.frost === glass.frost;
