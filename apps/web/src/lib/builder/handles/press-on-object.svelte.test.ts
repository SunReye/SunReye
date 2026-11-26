// A press on the picked object itself moves it (ADR 20): zoomed out, a small chimney's ring and
// arrows reach over it on screen, and still the chimney moves.
import "../../../app.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { presetView, SceneCanvas, type View } from "@sunreye/builder";
import type { Scene } from "@sunreye/scene";
import { onCanvas, press, pv, settle } from "../builder.harness.ts";

const CHIMNEY = { block: 0, face: 1, across: 5, up: 2, width: 0.3, depth: 0.3, height: 0.8 };

/** A 10 m × 8 m gable house pitched 35°, a small chimney on its south face. */
const scene: Scene = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [],
  chimneys: [CHIMNEY],
};

/** `view` drawn back `times` as far from what it looks at. */
function back({ position, target }: View, times: number): View {
  const out = (i: 0 | 1 | 2) => target[i] + (position[i] - target[i]) * times;

  return { position: [out(0), out(1), out(2)], target };
}

test("zoomed out, a press on a small chimney moves it, not its ring", async () => {
  const steps: Scene[] = [];
  const dropped = vi.fn();
  const ready = vi.fn();
  const geometry = pv.geometry(scene);
  const laid = pv.modules(scene, {});
  const view = back(presetView("isometric", geometry), 3);

  await render(SceneCanvas, {
    geometry,
    view,
    onview: () => {},
    onready: ready,
    editing: {
      scene,
      target: { kind: "chimney", index: 0 },
      pv,
      laid,
      turning: false,
      wholeBlock: true,
      ring: true,
      ondrag: (next: Scene) => {
        steps.push(next);
      },
      ondrop: dropped,
    },
  });
  await settle(() => ready.mock.calls.length === 1);

  const { foot, top } = laid.footings[0] ?? { foot: [], top: 0 };
  const mean = (axis: number) => foot.reduce((sum, p) => sum + (p[axis] ?? 0), 0) / 4;
  const onPage = onCanvas(scene, view);
  // Its top, then westward along the roof.
  const path = [0, 0.5, 1, 1.5, 2].map((west) => onPage([mean(0) - west, top, -mean(1)]));

  await press("mouse", path);

  await expect.poll(() => dropped.mock.calls.length).toBe(1);

  const chimney = steps.at(-1)?.chimneys?.[0];

  expect(chimney?.turn ?? 0).toBe(0);
  expect(chimney?.across).toBeLessThan(CHIMNEY.across);
});
