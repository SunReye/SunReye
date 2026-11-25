// The canvas in the tracing mode for the builder's tracing tests: a plain ground seen from above,
// kept on the scene each edit hands back.
import { render } from "vitest-browser-svelte";
import { presetView } from "../../../../../packages/builder/src/builder/camera.ts";
import type { Geometry, Scene } from "../../../../../packages/builder/src/builder/pv.ts";
import type { Placing, Projector, TraceEdit } from "@sunreye/builder";
import { SceneCanvas } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";

/** The plain ground under the tracing, 12 m square, seen from above. */
export const ground: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [-1, 1, 0],
        [11, 1, 0],
        [11, -11, 0],
        [-1, -11, 0],
      ],
    },
  ],
  solids: [],
};

export const EMPTY: Scene = { north: 0, blocks: [], obstacles: [] };

/** Where the scene lands on the page, and each edit's scene and edit. */
export interface Traced {
  readonly at: (x: number, z: number, height?: number) => [number, number];
  readonly scenes: Scene[];
  readonly edits: TraceEdit[];
}

/** A canvas in the tracing mode, kept on the scene each edit hands back; `placing` held until a
 * ready shape is placed. */
export async function tracing(
  start: Scene = EMPTY,
  held?: Placing,
  into?: number | "new",
): Promise<Traced> {
  const [scenes, edits]: [Scene[], TraceEdit[]] = [[], []];
  let project: Projector | undefined;

  const screen = await render(SceneCanvas, {
    geometry: ground,
    view: presetView("top", ground),
    onview: () => {},
    onrender: (next: Projector) => {
      project = next;
    },
    tracing: {
      scene: start,
      placing: held,
      into,
      ontrace: (scene: Scene, edit: TraceEdit) => {
        traced(scene, edit);
      },
    },
  });

  const traced = (scene: Scene, edit: TraceEdit): void => {
    scenes.push(scene);
    edits.push(edit);
    void screen.rerender({ tracing: { scene, into, ontrace: traced } });
  };

  await settle(() => project !== undefined);

  const canvas = screen.getByLabelText("3D-Szene des Hauses").element();

  return {
    // Scene x and z to page pixels: north 0, so east is x and north is −z.
    at: (x, z, height = 0) => {
      const { left, top } = canvas.getBoundingClientRect();
      const [px = 0, py = 0] = project?.([x, -z, height]) ?? [];

      return [left + px, top + py];
    },
    scenes,
    edits,
  };
}
