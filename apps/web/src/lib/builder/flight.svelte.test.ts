import "../../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { motion } from "../../../../../packages/builder/src/motion/tier.svelte.ts";
import { presetView } from "../../../../../packages/builder/src/builder/camera.ts";
import type { Geometry, Point } from "../../../../../packages/builder/src/builder/pv.ts";
import { SceneCanvas } from "@sunreye/builder";
import { stepUntil } from "../motion/clock.harness.ts";

type Projector = (point: Point) => readonly [number, number] | null;

/** A flat roof and a sphere beside it, off the camera's target. */
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
  solids: [{ kind: "sphere", centre: [-4, 0, 8], radius: 2 }],
};

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  motion.lowPower = false;
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** A frame of the injected clock. */
const FRAME = 16;

/** The house drawn from the south on an injected frame clock: `at` gives where the sphere's
 * centre was last drawn, `draws` counts draws. */
async function flying() {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });

  const draws = vi.spyOn(EffectComposer.prototype, "render");
  let project: Projector | undefined;

  const screen = await render(SceneCanvas, {
    geometry: house,
    view: presetView("south", house),
    onview: () => {},
    onrender: (next: Projector) => {
      project = next;
    },
  });

  await stepUntil(
    () => project !== undefined,
    () => {
      vi.advanceTimersByTime(FRAME);
    },
  );

  const at = (): readonly [number, number] => project?.([-4, 0, 8]) ?? [Number.NaN, Number.NaN];

  return { screen, at, draws: () => draws.mock.calls.length };
}

const apart = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0));

test("a new view flies the camera there, then nothing more is drawn", async () => {
  const { screen, at, draws } = await flying();
  const start = at();

  await screen.rerender({ view: presetView("east", house) });
  vi.advanceTimersByTime(300);

  const midway = at();
  const drawn = draws();

  expect(apart(midway, start)).toBeGreaterThan(1);

  vi.advanceTimersByTime(400);

  const landed = at();

  expect(draws()).toBeGreaterThan(drawn);
  expect(apart(landed, midway)).toBeGreaterThan(1);

  const idle = draws();

  vi.advanceTimersByTime(2000);
  expect(draws()).toBe(idle);
  expect(at()).toEqual(landed);
});

test("a new view mid-flight flies on from where the camera is", async () => {
  const { screen, at } = await flying();
  const start = at();

  await screen.rerender({ view: presetView("east", house) });
  vi.advanceTimersByTime(300);

  const midway = at();

  await screen.rerender({ view: presetView("north", house) });
  vi.advanceTimersByTime(FRAME);

  // Eased out of rest: one frame on, still about where the first flight left it.
  expect(apart(at(), midway)).toBeLessThan(apart(midway, start) / 4);
});

test.each([
  [
    "reduced motion",
    async (): Promise<void> => {
      await cdp().send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
    },
  ],
  [
    "the low-power switch",
    (): Promise<void> => {
      motion.lowPower = true;

      return Promise.resolve();
    },
  ],
])("under %s a new view is drawn at once, in one draw", async (_, still) => {
  await still();

  const { screen, at, draws } = await flying();
  const before = draws();

  await screen.rerender({ view: presetView("east", house) });
  vi.advanceTimersByTime(FRAME);

  const landed = at();

  vi.advanceTimersByTime(1000);
  expect(draws()).toBe(before + 1);
  expect(at()).toEqual(landed);
});
