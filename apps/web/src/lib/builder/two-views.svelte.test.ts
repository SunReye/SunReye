// Two views of one scene select a roof face together (ADR 25 "A roof face, in and out"): a click on
// a roof answers its block and face, and each canvas marks the face whose key its consumer hands it.
import "../../app.css";
import { Scene } from "three";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Geometry, RoofFace } from "@sunreye/pv-wasm";
import { roofFaceKey, type RoofFaceId } from "@sunreye/scene";
import { presetView, SceneCanvas, type Panel } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";

/** A flat roof 10 m by 8 m, 3 m up. */
const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, -8, 3],
        [10, -8, 3],
        [10, 0, 3],
        [0, 0, 3],
      ],
    },
  ],
  solids: [],
};

const ROOF: RoofFace = {
  block: 0,
  face: 1,
  tilt: 0,
  azimuth: 0,
  outline: [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ],
  origin: [0, -8, 3],
  across: [1, 0, 0],
  up: [0, 1, 0],
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Where a click on the canvas's middle selects, the roof bare or under a module. */
async function clicked(panels: readonly Panel[]): Promise<(RoofFaceId | null)[]> {
  const selected: (RoofFaceId | null)[] = [];
  const ready = vi.fn();

  await render(SceneCanvas, {
    geometry: house,
    panels,
    roofs: [ROOF],
    // From above, the roof's middle under the canvas's.
    view: presetView("top", house),
    onview: () => {},
    onready: ready,
    onselect: (face: RoofFaceId | null) => {
      selected.push(face);
    },
  });

  await settle(() => ready.mock.calls.length === 1);
  await page.getByLabelText("3D-Szene des Hauses").click();

  return selected;
}

test("a click on a roof answers its block and face, as either view's consumer selects it", async () => {
  const selected = await clicked([]);

  await expect.poll(() => selected).toEqual([{ block: 0, face: 1 }]);
});

test("a click on a module answers the face it lies on", async () => {
  // A module 2 m square over the roof's middle.
  const module: Panel = {
    corners: [
      [4, -5, 3.05],
      [6, -5, 3.05],
      [6, -3, 3.05],
      [4, -3, 3.05],
    ],
    grid: 0,
    module: 0,
  };

  const selected = await clicked([module]);

  await expect.poll(() => selected).toEqual([{ block: 0, face: 1 }]);
});

test("each view marks the face whose key its consumer hands it", async () => {
  const added = vi.spyOn(Scene.prototype, "add");
  const ready = { top: vi.fn(), isometric: vi.fn() };

  await Promise.all(
    (["top", "isometric"] as const).map((preset) =>
      render(SceneCanvas, {
        geometry: house,
        roofs: [ROOF],
        selected: roofFaceKey(ROOF),
        view: presetView(preset, house),
        onview: () => {},
        onready: ready[preset],
        label: preset,
      }),
    ),
  );

  await settle(() => ready.top.mock.calls.length === 1 && ready.isometric.mock.calls.length === 1);

  let marked = 0;

  for (const [object] of added.mock.calls) if (object?.name === "marked face") marked += 1;

  expect(marked).toBe(2);
});
