// An editor's ring on the scene canvas (ADR 20): a consumer that offers it beside the other
// handles turns a picked traced roof by dragging round it, one step shown at a time and one drop.
import "../../../app.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { presetView, SceneCanvas } from "@sunreye/builder";
import type { Scene } from "@sunreye/scene";
import { handles } from "../../../../../../packages/builder/src/builder/handles/grips.ts";
import { onCanvas, press, pv, settle } from "../builder.harness.ts";

const footprint = [
  [0, 0],
  [0, 6],
  [8, 6],
  [8, 0],
];

/** An 8 m by 6 m traced flat roof, 3 m up. */
const scene: Scene = {
  north: 0,
  blocks: [
    {
      x: 0,
      z: 0,
      width: 0,
      depth: 0,
      eave: 0,
      rotation: 0,
      roof: { kind: "flat" },
      freeForm: {
        footprint,
        faces: [footprint.map((corner: readonly number[]) => [corner[0] ?? 0, 3, corner[1] ?? 0])],
      },
    },
  ],
  obstacles: [],
};

const target = { kind: "block", index: 0 } as const;

test("a drag round an editor's ring turns a traced roof, settled on whole degrees", async () => {
  const steps: Scene[] = [];
  const dropped = vi.fn();
  const ready = vi.fn();
  const geometry = pv.geometry(scene);

  await render(SceneCanvas, {
    geometry,
    view: presetView("isometric", geometry),
    onview: () => {},
    onready: ready,
    editing: {
      scene,
      target,
      pv,
      laid: pv.modules(scene, {}),
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

  const [ring] = handles(scene, target);
  const [cx = 0, , cz = 0] = ring?.at ?? [];
  const radius = ring?.radius ?? 0;
  const onPage = onCanvas(scene);

  // From the ring's east point 37° clockwise round it, seen from above.
  const round = [0, 10, 20, 30, 37].map((deg) => {
    const at = (deg * Math.PI) / 180;

    return onPage([cx + radius * Math.cos(at), 0, cz + radius * Math.sin(at)]);
  });

  await press("mouse", round);

  await expect.poll(() => dropped.mock.calls.length).toBe(1);
  expect(steps.at(-1)?.blocks[0]?.rotation).toBe(37);
});
