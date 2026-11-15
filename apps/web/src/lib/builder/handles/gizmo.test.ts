/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Color, PerspectiveCamera, Vector3 } from "three";
import { nextBlock } from "../draft.ts";
import type { Scene } from "../pv.ts";
import { gizmo, handleOf } from "./gizmo.ts";
import { handles, type Target } from "./grips.ts";

// A handle's touch target is at least 44 px across, however far off the camera stands (ADR 20).

const BLOCK: Target = { kind: "block", index: 0 };

const scene: Scene = { north: 0, blocks: [nextBlock([])], obstacles: [] };

const CANVAS = { clientWidth: 400, clientHeight: 400 };

/** Straight down from far enough that the pitch knob's reach is drawn some 16 px wide. */
function distant(): PerspectiveCamera {
  const camera = new PerspectiveCamera(40, 1, 0.1, 5000);

  camera.position.set(5, 40, 4.01);
  camera.lookAt(5, 0, 4);
  camera.updateMatrixWorld();

  return camera;
}

/** `dx` canvas pixels right of the pitch knob, in NDC. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three's camera, read only.
function beside(camera: PerspectiveCamera, dx: number): [number, number] {
  const knob = handles(scene, BLOCK).find(({ grip }) => grip === "pitch");

  if (knob === undefined) throw new Error("no pitch knob");

  const at = new Vector3(...knob.at).project(camera);

  return [at.x + (2 * dx) / CANVAS.clientWidth, at.y];
}

test("a press 20 px beside a far-off knob grabs it; 30 px beside, nothing", () => {
  const camera = distant();
  const shown = gizmo(handles(scene, BLOCK), new Color("#06f"));

  shown.updateMatrixWorld(true);

  expect(handleOf(shown, camera, beside(camera, 20), CANVAS)?.grip).toBe("pitch");
  expect(handleOf(shown, camera, beside(camera, 30), CANVAS)).toBeNull();
});
