import { flushSync } from "svelte";
import { afterAll, expect, test, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { Studio } from "./studio.ts";
import { DRY, type Falling } from "./weather.ts";

const SNOW: Falling = { kind: "snow", density: 1, wind: [0, 0] };

afterAll(() => {
  localStorage.clear();
});

test("lite draws a sparse still field and never loops", async () => {
  // A device the frame watch found struggling, before the motion tier is read.
  localStorage.setItem("sunreye.motion-strain", "1");

  const { lit } = await import("./stage.svelte.ts");
  const canvas = document.createElement("canvas");
  const fell = vi.spyOn(Studio.prototype, "fall");
  const drifted = vi.spyOn(Studio.prototype, "drift");
  let running: boolean | undefined;

  document.body.append(canvas);

  const unmount = $effect.root(() => {
    const scene = lit(
      canvas,
      new PerspectiveCamera(40, 1, 0.1, 5000),
      () => ({ sun: null, diffuse: null, weather: { ...DRY, falling: SNOW } }),
      () => {},
    );

    flushSync();
    ({ running } = scene.loop);
    scene.dispose();
  });

  unmount();
  canvas.remove();

  expect(fell.mock.lastCall).toEqual([SNOW, true]);
  expect(running).toBe(false);
  expect(drifted).not.toHaveBeenCalled();
});
