import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { MODULE, pv } from "../builder/builder.harness.ts";
import { Studio } from "../../../../../packages/builder/src/scene/studio.ts";
import { DRY, type Plant } from "../../../../../packages/builder/src/scene/weather.ts";
import { chip, frame, layout, scene } from "./live-scene.harness.ts";
import { feed } from "./stream.harness.ts";
import LiveScene from "./LiveScene.svelte";

test("the scene's weather is asked with the plant's share of its peak, and a tick that leaves it as it was lights nothing anew", async () => {
  const lit = vi.spyOn(Studio.prototype, "light");
  const asked: Plant[] = [];
  const tick = feed();

  await render(LiveScene, {
    onselect: () => {},
    pv,
    layout,
    scene,
    moduleTypes: [MODULE],
    capabilities: undefined,
    // Wet, and a new object each time it is asked.
    weather: (plant: Plant) => {
      asked.push(plant);

      return { ...DRY, wet: 1 };
    },
  });

  // Two modules of 400 W.
  tick(frame(600, -1200));
  await chip("Süd", "600");
  expect(asked.at(-1)).toEqual({ sun: null, share: 0.75 });
  expect(lit.mock.lastCall?.[3]).toEqual({ ...DRY, wet: 1 });

  const lights = lit.mock.calls.length;

  tick(frame(700, -1100));
  await chip("Süd", "700");
  expect(asked.at(-1)).toEqual({ sun: null, share: 0.875 });
  expect(lit.mock.calls.length).toBe(lights);
});
