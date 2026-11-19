/// <reference types="bun" />
import { expect, test } from "bun:test";
import { asked, readout } from "./perf-lines.ts";

// The scene's readout as text (ADR 21 "Measuring").

test("`?perf` in the hash route's query asks for the readout, on any route", () => {
  expect(asked("#/?perf")).toBe(true);
  expect(asked("#/builder?view=top&perf")).toBe(true);
  expect(asked("#/")).toBe(false);
  expect(asked("#/performance")).toBe(false);
  expect(asked("")).toBe(false);
});

const frame = {
  calls: 87,
  triangles: 657,
  programs: 41,
  shadows: 1,
  script: 1.44,
  passes: [
    { target: "shadow", width: 4096, height: 4096, samples: 0, calls: 5 },
    { target: "target", width: 780, height: 1200, samples: 4, calls: 40 },
    { target: "canvas", width: 780, height: 1200, samples: 0, calls: 1 },
  ],
} as const;

const facts = {
  frame,
  fps: 58,
  gpu: 3.21,
  pixelRatio: 2,
  shadowMap: 4096,
  occlusion: true,
  contact: false,
  quality: "auto",
  level: "high",
  tier: "full",
  looping: true,
  renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)",
  strains: { drawing: "1", motion: null, at: "1795000000000" },
} as const;

test("the readout tells a frame's rate, times, draws and passes, and what this browser draws", () => {
  expect(readout(facts)).toEqual([
    "58 fps · JS 1.4 ms · GPU 3.2 ms",
    "87 draws · 657 tris · 41 programs · 1 shadow map",
    "DPR 2 · canvas 780×1200 · 3 passes",
    "  shadow 4096×4096",
    "  target 780×1200 ×4",
    "  canvas 780×1200",
    "shadow map 4096 · AO on · contact shadows off",
    "quality auto → high · tier full · loop on",
    "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)",
    "3d-strain 1 · motion-strain – · strained-at 1795000000000",
  ]);
});

test("a GPU that tells no time, an unnamed one and a frame not yet drawn read as none", () => {
  expect(
    readout({ ...facts, frame: undefined, gpu: null, renderer: null, looping: false }),
  ).toEqual([
    "58 fps · JS – ms · GPU – ms",
    "no frame drawn yet",
    "shadow map 4096 · AO on · contact shadows off",
    "quality auto → high · tier full · loop off",
    "GPU unnamed",
    "3d-strain 1 · motion-strain – · strained-at 1795000000000",
  ]);
});
