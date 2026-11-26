// The canvas in the tracing mode for the builder's tracing tests: a plain ground seen from above,
// kept on the scene each edit hands back.
import { render } from "vitest-browser-svelte";
import { presetView, type Preset } from "../../../../../packages/builder/src/builder/camera.ts";
import type { Geometry, Scene } from "../../../../../packages/builder/src/builder/pv.ts";
import type { Placing, Projector, TraceEdit } from "@sunreye/builder";
import { SceneCanvas } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";

/** The plain ground under the tracing, 12 m square, seen from above. */
const ground: Geometry = {
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
  /** Scene x and z to page pixels: north 0, so east is x and north is −z. */
  readonly at: (x: number, z: number, height?: number) => [number, number];
  readonly scenes: Scene[];
  readonly edits: TraceEdit[];
  /** Tracing turned off, as another tool does, or on again on the last scene, drawing or only
   * editing what is traced. */
  readonly retool: (to: "off" | "draw" | "edit") => Promise<void>;
}

/** Where pv point `point` lands on the page, by the canvas's last projection. */
function onPage(
  canvas: Element,
  project: Projector | undefined,
  point: readonly [number, number, number],
): [number, number] {
  const { left, top } = canvas.getBoundingClientRect();
  const [px = 0, py = 0] = project?.(point) ?? [];

  return [left + px, top + py];
}

/** A canvas in the tracing mode, kept on the scene each edit hands back; `placing` held until a
 * ready shape is placed; seen from `preset`, from above unless named. */
export async function tracing(
  start: Scene = EMPTY,
  held?: Placing,
  into?: number | "new",
  drawing?: false,
  preset: Preset = "top",
): Promise<Traced> {
  const [scenes, edits]: [Scene[], TraceEdit[]] = [[], []];
  let project: Projector | undefined;

  /** The tracing on `scene`, which each edit hands on. */
  let draws = drawing;

  const on = (scene: Scene) => ({ scene, into, drawing: draws, ontrace: traced });

  function traced(scene: Scene, edit: TraceEdit): void {
    scenes.push(scene);
    edits.push(edit);
    void screen.rerender({ tracing: on(scene) });
  }

  const screen = await render(SceneCanvas, {
    geometry: ground,
    view: presetView(preset, ground),
    onview: () => {},
    onrender: (next: Projector) => {
      project = next;
    },
    tracing: { ...on(start), placing: held },
  });

  await settle(() => project !== undefined);

  const canvas = screen.getByLabelText("3D-Szene des Hauses").element();

  return {
    at: (x, z, height = 0) => onPage(canvas, project, [x, -z, height]),
    scenes,
    edits,
    retool: (to) => {
      draws = to === "edit" ? false : drawing;

      return screen.rerender({ tracing: to === "off" ? undefined : on(scenes.at(-1) ?? start) });
    },
  };
}
