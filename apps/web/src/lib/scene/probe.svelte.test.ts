import { afterEach, expect, test } from "vitest";
import { measured, PHONE, screen, shut, told } from "./probe.harness.ts";

// What a frame of the scene draws, counted (ADR 21 "Measuring"): this host has no GPU, so a
// frame's cost is told by its passes, their sizes and its draws, never by its time.

afterEach(async () => {
  shut();
  await screen();
});

test("a frame's draw calls, triangles and programs are counted, each frame anew", () => {
  const { frame } = measured("low");
  const first = frame();

  // The floor and the box, at the least, of twelve triangles and more.
  expect(first.calls).toBeGreaterThanOrEqual(2);
  expect(first.triangles).toBeGreaterThanOrEqual(12);
  expect(first.programs).toBeGreaterThan(0);
  expect(first.script).toBeGreaterThanOrEqual(0);

  // The frames after draw no shadow map, and the same as each other: nothing adds up.
  const second = frame();
  const third = frame();

  expect(second.calls).toBeLessThan(first.calls);
  expect([third.calls, third.triangles]).toEqual([second.calls, second.triangles]);
});

test("a frame's passes are told with the size of what each drew into", async () => {
  await screen(PHONE.ratio);

  const { frame } = measured("low", [PHONE.width, PHONE.height]);

  // Niedrig: the sun's shadow, the scene at a pixel ratio of 1, and the picture onto the canvas.
  expect(told(frame())).toEqual(["shadow 1024×1024", "target 390×600 ×4", "canvas 390×600"]);
});

test("the frames drawn in the last second are the rate", () => {
  let now = 10_000;
  const { studio, probe } = measured("low", [64, 64], () => now);

  for (let drawn = 0; drawn < 30; drawn++) {
    now += 20;
    studio.render();
  }

  // 30 frames in 600 ms, and none before.
  expect(probe.fps).toBe(30);

  now += 700;
  // Only those of the last second: the 15 drawn after the first 300 ms.
  expect(probe.fps).toBe(15);

  now += 1000;
  expect(probe.fps).toBe(0);
});

test("the GPU's time is told where the browser measures it, and is none where it does not", () => {
  const { studio, probe, frame } = measured("low");

  const measures =
    studio.renderer.getContext().getExtension("EXT_disjoint_timer_query_webgl2") !== null;

  for (let drawn = 0; drawn < 8; drawn++) frame();

  if (measures) expect(probe.gpu === null || probe.gpu >= 0).toBe(true);
  else expect(probe.gpu).toBeNull();

  expect(studio.renderer.getContext().getError()).toBe(0);
});
