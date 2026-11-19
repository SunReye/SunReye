import { flushSync } from "svelte";
import { afterAll, expect, test, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { Studio } from "./studio.ts";
import { DRY, type Falling } from "./weather.ts";

const SNOW: Falling = { kind: "snow", density: 1, wind: [0, 0] };

/** `count` of the display's frames, one after the other. */
async function frames(count: number): Promise<void> {
  if (count === 0) return;

  await new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
  await frames(count - 1);
}

afterAll(() => {
  localStorage.clear();
});

test("lite draws a sparse still field and never loops", async () => {
  // A device the frame watch found struggling, before the motion tier is read.
  localStorage.setItem("sunreye.motion-strain", "1");
  localStorage.setItem("sunreye.strained-at", String(Date.now()));

  const { lit } = await import("./stage.svelte.ts");
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
