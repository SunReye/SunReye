import "../../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { Parked } from "@sunreye/builder/cars/parked.ts";
import { Opening } from "@sunreye/builder/scene/opening.svelte.ts";
import { presetView } from "@sunreye/builder/builder/camera.ts";
import type { Geometry } from "@sunreye/builder/builder/pv.ts";
import { SceneCanvas } from "@sunreye/builder";
import { turn } from "../api/settled.harness.ts";
import { settle } from "../motion/clock.harness.ts";
import { canvasWords } from "./canvas-words.ts";

const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, -8, 3],
        [0, -8, 3],
      ],
    },
  ],
  solids: [],
};

const car: Parked = {
  device: 7,
  at: [4, -3, 0],
  forward: [0, 1, 0],
  above: [4, -3, 2.5],
  length: 5,
  width: 2.5,
  colour: "#f2f2ee",
  model: null,
  watts: 7360,
  soc: 63,
};

afterEach(() => {
  vi.restoreAllMocks();
});

type Settled = () => readonly { readonly type: string }[];

/** Whether an arrival still runs. */
function running(settledResults: Settled): boolean {
  let some = false;

  for (const { type } of settledResults()) some ||= type === "incomplete";

  return some;
}

/** Each arrival so far has finished, and a later one, chained on its promise, had its turn. */
async function settled(settledResults: Settled): Promise<void> {
  await settle(() => !running(settledResults));
  await turn();
}

test("a live tick that changes only a car's power or SOC brings no car anew", async () => {
  // Each arrival snapshots the canvas for its fade: a stutter on every tick.
  const arrive = vi.spyOn(Opening.prototype, "arrive");
  const results = () => arrive.mock.settledResults;

  const screen = await render(SceneCanvas, {
    words: canvasWords(),
    geometry: house,
    view: presetView("isometric", house),
    onview: () => {},
    cars: [car],
  });

  await settle(() => arrive.mock.calls.length === 1);
  await settled(results);

  await screen.rerender({ cars: [{ ...car, watts: 0, soc: 64 }] });
  await screen.rerender({ cars: [] });

  await settle(() => arrive.mock.calls.length >= 2);
  await settled(results);
  expect(arrive).toHaveBeenCalledTimes(2);
});
