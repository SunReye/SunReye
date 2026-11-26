import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { afterEach, expect, test, vi } from "vitest";
import { look, measured, PHONE, screen, unmeasure, told } from "./probe.harness.ts";

// What a frame of the scene draws, counted (ADR 21 "Measuring"): this host has no GPU, so a
// frame's cost is told by its passes, their sizes and its draws, never by its time.

afterEach(async () => {
  unmeasure();
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

test("what Ultra's burst draws after a frame is no part of that frame", () => {
  const { studio, probe, frame } = measured("ultra");
  const passes = told(frame());

  while (studio.refine());

  expect(told(probe.last ?? frame())).toEqual(passes);
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

test("the scene is antialiased in its own target, and the canvas it is copied onto is not", () => {
  const { studio, frame } = measured("medium");
  const scene = frame().passes.find(({ target }) => target === "target");

  // Only the finished picture reaches the canvas: samples of its own would be filled for nothing.
  expect(studio.renderer.getContext().getContextAttributes()?.antialias).toBe(false);
  expect(scene?.samples).toBe(4);
});

test("only the scene is drawn multisampled: no pass after it is, the lens glass's neither", () => {
  const { studio, frame } = measured("high");

  studio.lens({ rain: 1, snow: 0, frost: 0 }, 0);

  const passes = frame().passes.filter(({ target }) => target === "target");

  // The scene, the occlusion's three and its composite, tone mapping and the glass's field.
  expect(passes).toHaveLength(7);
  expect(passes.map(({ samples }) => samples)).toEqual([4, 0, 0, 0, 0, 0, 0]);
});

test("on a phone Mittel draws its occlusion at half its pixel ratio, and Hoch at Mittel's", async () => {
  await screen(PHONE.ratio);

  const size = [PHONE.width, PHONE.height] as const;

  expect(told(measured("medium", size).frame())).toEqual([
    "shadow 2048×2048",
    "target 585×900 ×4",
    // The occlusion's normals, its samples and their denoising.
    "target 293×450",
    "target 293×450",
    "target 293×450",
    // Its blend over the picture, which no longer needs the scene's samples.
    "target 585×900",
    "canvas 585×900",
  ]);
  expect(told(measured("high", size).frame())).toEqual([
    "shadow 4096×4096",
    "target 780×1200 ×4",
    "target 585×900",
    "target 585×900",
    "target 585×900",
    "target 780×1200",
    "canvas 780×1200",
  ]);
});

test("Mittel's occlusion takes 8 samples a pixel and Hoch's 12", () => {
  const sampled = vi.spyOn(GTAOPass.prototype, "updateGtaoMaterial");
  const denoised = vi.spyOn(GTAOPass.prototype, "updatePdMaterial");
  const last = () => [sampled.mock.lastCall?.[0].samples, denoised.mock.lastCall?.[0].samples];
  const { studio } = measured("medium");

  expect(last()).toEqual([8, 8]);

  studio.follow(look("high"));
  expect(last()).toEqual([12, 12]);

  studio.follow(look("medium"));
  expect(last()).toEqual([8, 8]);
  vi.restoreAllMocks();
});
