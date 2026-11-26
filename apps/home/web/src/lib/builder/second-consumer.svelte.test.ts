// A consumer that puts the scene canvas under its own ribbon lays modules with the frame's rules
// (ADR 25): it builds the laying from the package's public entries only, holds the scene, and takes
// each step and the release from the canvas.
import "../../app.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { layingOf, presetView, SceneCanvas, stringCss, type Laying } from "@sunreye/builder";
import { emptyDraft, type Draft } from "@sunreye/builder/frame";
import type { Scene } from "@sunreye/scene";
import { faceOnPage, MODULE, press, pv, settle, SIZES } from "./builder.harness.ts";

/** A 10 m × 8 m gable house with an empty grid on its south face. */
const scene: Scene = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [],
  grids: [
    { block: 0, face: 1, moduleType: MODULE.id, landscape: false, setback: 0.3, modules: [] },
  ],
};

test("a press on the selected face lays a module through the public laying", async () => {
  const draft: Draft = { ...emptyDraft(), scene };
  const steps: Scene[] = [];
  let dropped = 0;
  const ready = vi.fn();

  const laying: Laying | undefined = layingOf(
    { kind: "face", block: 0, face: 1 },
    {
      draft,
      laid: pv.modules(scene, SIZES),
      pv,
      sizes: SIZES,
      ondrag: (next) => {
        steps.push(next);
      },
      ondrop: () => {
        dropped += 1;
      },
      go: () => {},
    },
  );

  expect(laying?.selected).toEqual([]);

  const geometry = pv.geometry(scene);

  await render(SceneCanvas, {
    geometry,
    view: presetView("isometric", geometry),
    onview: () => {},
    onready: ready,
    roofwork: laying,
  });
  await settle(() => ready.mock.calls.length === 1);

  // The pointer holds a portrait module's middle: 0.567 m across and 0.861 m up from its corner.
  await press("mouse", [faceOnPage(scene, 0)(1.067, 1.361)]);

  await expect.poll(() => dropped).toBe(1);
  expect(
    steps
      .at(-1)
      ?.grids?.[0]?.modules.map((laid) =>
        "across" in laid ? [Math.round(laid.across * 1000), Math.round(laid.up * 1000)] : [],
      ),
  ).toEqual([[500, 500]]);
});

test("a consumer draws a string in the colour its modules glow in, grey in none", () => {
  // The first string's blue, and again for the seventh; the scene's grey for a module in none.
  expect([stringCss(0), stringCss(6), stringCss(null)]).toEqual(["#1f5fbf", "#1f5fbf", "#6b6f76"]);
});
