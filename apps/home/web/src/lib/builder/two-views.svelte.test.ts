// Two views of one scene select a roof face together (ADR 25 "A roof face, in and out"): a click on
// a roof answers its block and face, and each canvas marks the face whose key its consumer hands it.
import "../../app.css";
import { Scene } from "three";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Geometry, RoofFace } from "@sunreye/pv-wasm";
import { roofFaceKey, type RoofFaceId } from "@sunreye/scene";
import { presetView, SceneCanvas, type Panel } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";
import { house as gable, onCanvas, press, pv, undrawn } from "./builder.harness.ts";

beforeEach(() => {
  undrawn();
});

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

test("a click near a pitched roof's eave, as the engine draws it, answers that face", async () => {
  const { scene } = gable();
  const geometry = pv.geometry(scene);
  const { roofs } = pv.modules(scene, {});
  const selected: (RoofFaceId | null)[] = [];
  const ready = vi.fn();
  const view = presetView("isometric", geometry);

  await render(SceneCanvas, {
    geometry,
    roofs,
    view,
    onview: () => {},
    onready: ready,
    onselect: (face: RoofFaceId | null) => {
      selected.push(face);
    },
  });

  await settle(() => ready.mock.calls.length === 1);

  // The face toward the camera, a hand's breadth up from its eave, halfway along.
  const roof = roofs.find(({ azimuth }) => Math.abs(azimuth) < 1);
  const xs = roof?.outline.map(([x]) => x) ?? [];
  const [across, up] = [(Math.min(...xs) + Math.max(...xs)) / 2, 0.15];

  const at = (i: 0 | 1 | 2): number =>
    (roof?.origin[i] ?? 0) + across * (roof?.across[i] ?? 0) + up * (roof?.up[i] ?? 0);

  await press("mouse", [onCanvas(scene, view)([at(0), at(2), 0 - at(1)])]);

  await expect.poll(() => selected).toEqual([{ block: roof?.block, face: roof?.face }]);
});
