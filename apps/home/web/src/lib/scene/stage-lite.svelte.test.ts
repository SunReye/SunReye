import { flushSync } from "svelte";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { frames } from "../motion/clock.harness.ts";
import { Studio } from "../../../../../../packages/builder/src/scene/studio.ts";
import { DRY, type Falling } from "../../../../../../packages/builder/src/scene/weather.ts";

const SNOW: Falling = { kind: "snow", density: 1, wind: [0, 0] };

afterAll(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

test("lite draws a sparse still field and never loops", async () => {
  // A device the frame watch found struggling, before the motion tier is read.
  localStorage.setItem("sunreye.motion-strain", "1");
  localStorage.setItem("sunreye.strained-at", String(Date.now()));

  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });

  const { lit } = await import("../../../../../../packages/builder/src/scene/stage.svelte.ts");
  const canvas = document.createElement("canvas");
  const fell = vi.spyOn(Studio.prototype, "fall");
  const drifted = vi.spyOn(Studio.prototype, "drift");
  const drawn = vi.spyOn(Studio.prototype, "render");
  let scene: { dispose: () => void } | undefined;

  document.body.append(canvas);

  const unmount = $effect.root(() => {
    scene = lit(
      canvas,
      new PerspectiveCamera(40, 1, 0.1, 5000),
      () => ({ sun: null, diffuse: null, weather: { ...DRY, falling: SNOW } }),
      () => {},
    );

    flushSync();
  });

  // What was asked for is drawn; from then on it draws nothing on its own.
  await frames(4);

  const before = drawn.mock.calls.length;

  await frames(8);

  const own = drawn.mock.calls.length - before;

  scene?.dispose();
  unmount();
  canvas.remove();

  expect(fell.mock.lastCall).toEqual([SNOW, true]);
  expect(own).toBe(0);
  expect(drifted).not.toHaveBeenCalled();
});
