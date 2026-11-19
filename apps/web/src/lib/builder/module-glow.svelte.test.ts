import { afterEach, expect, test } from "vitest";
import { buildScene, tint, type Panel } from "./scene.ts";
import type { Geometry } from "./pv.ts";
import { measured, unmeasure } from "../scene/probe.harness.ts";

// The modules as drawn (ADR 20 Rendering): one instanced draw, each with its own glow.

afterEach(unmeasure);

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

/** A module 3 m square about `east`, on the roof. */
const square = (east: number): Panel["corners"] => [
  [east - 1.5, 1.5, 3],
  [east + 1.5, 1.5, 3],
  [east + 1.5, -1.5, 3],
  [east - 1.5, -1.5, 3],
];

/** Many modules in a row along the roof's north edge: 32 of them. */
const row: Panel[] = Array.from({ length: 32 }, (_, i) => ({
  corners: [
    [-5.8 + i * 0.36, 5.8, 3],
    [-5.5 + i * 0.36, 5.8, 3],
    [-5.5 + i * 0.36, 5, 3],
    [-5.8 + i * 0.36, 5, 3],
  ],
  string: i % 3,
}));

/** A studio looking straight down on the roof, `panels` on it, and the picture's pixel at a
 * point of the roof. */
function above(panels: readonly Panel[]) {
  const scene = measured("medium");
  const group = buildScene(house, panels);
  const gl = scene.studio.renderer.getContext();

  scene.studio.camera.position.set(0, 20, 0.001);
  scene.studio.camera.lookAt(0, 3, 0);
  scene.studio.scene.add(group);

  return {
    ...scene,
    group,
    /** The red, green and blue drawn at `east` on the roof's middle line. */
    at: (east: number): number[] => {
      const pixel = new Uint8Array(4);

      // The picture is 64 px over about 14.5 m at the roof's height.
      scene.frame();
      gl.readPixels(
        Math.round(32 + (east / 14.5) * 64),
        32,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );

      return [...pixel.subarray(0, 3)];
    },
  };
}

test("32 modules are drawn in as many draw calls as one", () => {
  const one = above(row.slice(0, 1)).frame().calls;
  const many = above(row).frame();

  expect(many.calls).toBe(one);
  // And all of them are drawn: 12 triangles each, in the scene's pass and in the occlusion's.
  expect(many.triangles).toBeGreaterThanOrEqual(32 * 12 * 2);
});

test("each module glows in its own colour: a wired string's brightly, beside one in no string", () => {
  const failed: string[] = [];

  const { studio, group, at } = above([
    { corners: square(-3), string: 0, bright: true },
    { corners: square(3) },
  ]);

  studio.renderer.debug.onShaderError = () => {
    failed.push("shader");
  };

  const [wired, loose] = [at(-3), at(3)];

  // String 0 is blue: its cells shine blue, far over the grey of a module in no string.
  expect(wired[2]).toBeGreaterThan((wired[0] ?? 0) + 40);
  expect(wired[2]).toBeGreaterThan((loose[2] ?? 0) + 40);

  // Live, by each string's share of peak, in the solar colour: red over blue.
  tint(group, [1, 0], { colour: 0xffa63a, daylight: 1 });

  const [full, idle] = [at(-3), at(3)];

  expect(full[0]).toBeGreaterThan(full[2] ?? 0);
  expect(full[0]).toBeGreaterThan(idle[0] ?? 0);
  expect(failed).toEqual([]);
  expect(studio.renderer.getContext().getError()).toBe(0);
});
