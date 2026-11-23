import { flushSync } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { buildScene, type Panel } from "../../../../../packages/builder/src/builder/scene.ts";
import type { Geometry } from "../../../../../packages/builder/src/builder/pv.ts";
import { frameLimit } from "../../../../../packages/builder/src/scene/frame-limit.svelte.ts";
import { open, RAIN, shut } from "./stage.harness.svelte.ts";

// Every frame the scene draws is held to this browser's frame limit (ADR 21 "Frame limit"):
// the loop's, an orbit's, a flight's and a tint's. The display's frames are given by hand.

afterEach(() => {
  frameLimit.choice = "unlimited";
  vi.unstubAllGlobals();
  shut();
});

/** A display whose frames the test gives, `ms` apart; from here on nothing else gives one. */
function display() {
  const asked = new Map<number, FrameRequestCallback>();
  let id = 0;
  // Later than any frame the page gave before: the display's clock only moves on.
  let now = 1e9;

  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    id += 1;
    asked.set(id, frame);

    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => {
    asked.delete(frame);
  });
  // The display's clock is the page's: what starts between two frames starts at the last one.
  vi.spyOn(performance, "now").mockImplementation(() => now);

  return {
    /** Gives `count` frames, `ms` apart, `each` before every one. */
    run: (count: number, ms = 1000 / 60, each: () => void = () => {}): void => {
      for (let given = 0; given < count; given++) {
        each();
        now += ms;

        const frames = [...asked.values()];

        asked.clear();

        for (const frame of frames) frame(now);
      }
    },
  };
}

/** A lit scene whose frames the test gives, and how many it drew since last asked. */
async function staged() {
  const scene = await open();
  const screen = display();
  let seen = scene.drawn.mock.calls.length;

  return {
    ...scene,
    screen,
    drew: (): number => {
      const since = scene.drawn.mock.calls.length - seen;

      seen = scene.drawn.mock.calls.length;

      return since;
    },
  };
}

test("rain is drawn in every frame the display gives; a frame limit holds it to its rate", async () => {
  const { screen, weather, drew } = await staged();

  weather(RAIN);
  screen.run(4);
  drew();

  screen.run(60);
  expect(drew()).toBe(60);

  // A limit holds from the next frame on; the frame it changes at may be one more.
  frameLimit.choice = "30";
  screen.run(2);
  drew();
  screen.run(60);
  expect(drew()).toBe(30);

  frameLimit.choice = "60";
  screen.run(2, 1000 / 120);
  drew();
  screen.run(120, 1000 / 120);
  expect(drew()).toBe(60);
});

test("an orbit's frames are held to the limit, and its last move is always drawn", async () => {
  const { scene, screen, seen, drew } = await staged();

  frameLimit.choice = "30";
  screen.run(4);
  drew();

  // A finger moves the camera with every frame of a 60 Hz display, for 21 of them.
  screen.run(21, 1000 / 60, scene.opening.render);
  expect(drew()).toBe(11);

  const labels = seen.labels;

  // It lifts between two frames the limit allows: the move still shows, labels with it.
  scene.opening.render();
  screen.run(1);
  expect(drew()).toBe(0);
  screen.run(1);
  expect(drew()).toBe(1);
  expect(seen.labels).toBe(labels + 1);

  // And then nothing draws.
  screen.run(30);
  expect(drew()).toBe(0);
});

test("a camera flight is drawn at the limit, and lands where it flew to", async () => {
  const { scene, screen, drew } = await staged();
  const places: number[] = [];

  frameLimit.choice = "30";
  screen.run(4);
  drew();

  scene.opening.flight.fly(
    { position: [10, 5, 10], target: [0, 0, 0] },
    { position: [-10, 5, 10], target: [0, 0, 0] },
    ({ position }) => {
      places.push(position[0]);
    },
  );
  scene.opening.render();
  // 600 ms of flight and more: 60 frames of a 60 Hz display.
  screen.run(60);

  // At 30 a second, about 600 ms of them, and none after it landed.
  expect(drew()).toBeGreaterThanOrEqual(18);
  expect(places.length).toBeLessThanOrEqual(21);
  expect(places.at(-1)).toBeCloseTo(-10, 5);
});

const roof: Geometry = {
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

const panels: Panel[] = [0, 1].map((i) => ({
  corners: [
    [1 + i * 2, -1, 3],
    [2 + i * 2, -1, 3],
    [2 + i * 2, -2.7, 3],
    [1 + i * 2, -2.7, 3],
  ],
  string: i,
}));

test("a tick's tint glides in drawn frames under the limit, steps when it barely moved, and draws nothing when nothing did", async () => {
  const { scene, screen, drew } = await staged();
  const group = buildScene(roof, panels);
  let shares = $state.raw<readonly (number | null)[]>([0.5, 0.5]);

  scene.show(group);

  const stop = $effect.root(() => {
    scene.ease(
      () => group,
      () => shares,
    );
  });

  const tick = (next: readonly (number | null)[]): number => {
    shares = next;
    flushSync();
    // A second of a 60 Hz display.
    screen.run(60);

    return drew();
  };

  // The first shares show at once.
  flushSync();
  screen.run(4);
  expect(drew()).toBe(1);

  // A cloud's edge: 400 ms of glide at every frame, then rendering stops.
  expect(tick([0.9, 0.2])).toBeGreaterThanOrEqual(23);
  expect(tick([0.2, 0.9])).toBeLessThanOrEqual(26);

  // Under a limit of 30, half as many.
  frameLimit.choice = "30";

  const limited = tick([0.9, 0.2]);

  expect(limited).toBeGreaterThanOrEqual(11);
  expect(limited).toBeLessThanOrEqual(14);

  // A steady sun: a string a thousandth of its peak up shows no different, and is one frame.
  expect(tick([0.901, 0.2])).toBe(1);
  // The same shares again: no frame at all.
  expect(tick([0.901, 0.2])).toBe(0);
  stop();
});

test("while its consumer says the live values halted, a tick's tint steps in one frame", async () => {
  const { scene, screen, drew } = await staged();
  const group = buildScene(roof, panels);
  let shares = $state.raw<readonly (number | null)[]>([0.5, 0.5]);
  let halted = $state(true);

  scene.show(group);

  const stop = $effect.root(() => {
    scene.ease(
      () => group,
      () => shares,
      () => halted,
    );
  });

  const tick = (next: readonly (number | null)[]): number => {
    shares = next;
    flushSync();
    screen.run(60);

    return drew();
  };

  flushSync();
  screen.run(4);
  expect(drew()).toBe(1);

  expect(tick([0.9, 0.2])).toBe(1);

  // Back: it glides again.
  halted = false;
  expect(tick([0.2, 0.9])).toBeGreaterThanOrEqual(23);
  stop();
});
