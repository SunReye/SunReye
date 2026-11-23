import { afterEach, expect, test, vi } from "vitest";
import { measured, unmeasure } from "../scene/probe.harness.ts";
import { stage } from "@sunreye/builder/scene/staged.ts";
import type { Geometry } from "@sunreye/builder/builder/pv.ts";
import { buildScene, type Panel } from "@sunreye/builder/builder/scene.ts";

// Every builder edit draws the scene anew (ADR 20 Rendering): what the last one held on the GPU
// is freed, the instanced modules' own buffers too.

afterEach(() => {
  vi.restoreAllMocks();
  unmeasure();
});

/** A level roof at 3 m. */
const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [-6, 6, 3],
        [6, 6, 3],
        [6, -6, 3],
        [-6, -6, 3],
      ],
    },
  ],
  solids: [],
};

/** Eight modules in a row on the roof. */
const row: Panel[] = Array.from({ length: 8 }, (_, i) => ({
  corners: [
    [-5 + i, 1, 3],
    [-4.2 + i, 1, 3],
    [-4.2 + i, -1, 3],
    [-5 + i, -1, 3],
  ],
  string: i % 2,
}));

test("a scene built again leaves no more on the GPU than the one before it", () => {
  const { studio, frame } = measured("low");
  const gl = studio.renderer.getContext();
  const made = vi.spyOn(gl, "createBuffer");
  const freed = vi.spyOn(gl, "deleteBuffer");
  const shown = stage(studio);

  /** What the GPU holds once the scene is built and drawn: three.js's count, and live buffers. */
  const held = () => {
    shown.show(buildScene(house, row));
    frame();

    const { geometries, textures } = studio.renderer.info.memory;

    return { geometries, textures, buffers: made.mock.calls.length - freed.mock.calls.length };
  };

  held();

  // From the second on: the first frees nothing, as nothing was drawn before it.
  const second = held();

  held();
  held();
  expect(held()).toEqual(second);
});
