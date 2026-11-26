import { BoxGeometry, Color, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { daylight, theme } from "../../../../../../packages/builder/src/scene/light.ts";
import { look } from "./probe.harness.ts";
import type { Level } from "../../../../../../packages/builder/src/scene/quality.ts";
import { Studio } from "../../../../../../packages/builder/src/scene/studio.ts";

export const mean = (some: readonly number[]): number =>
  some.reduce((sum, v) => sum + v, 0) / some.length;

export const SIDE = 256;

/** A 6 m post on a pale floor under a low sun from the east, seen from straight above its shadow. */
export function post(level: Level): Studio {
  const canvas = document.createElement("canvas");
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);

  camera.position.set(-6, 30, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(-6, 0, 0);
  const studio = new Studio(canvas, camera, () => look(level));
  studio.setSize(SIDE, SIDE);

  const floor = new Mesh(
    new BoxGeometry(60, 0.2, 60),
    new MeshStandardMaterial({ color: 0xcccccc }),
  );

  const upright = new Mesh(new BoxGeometry(1, 6, 1), new MeshStandardMaterial());

  floor.position.y = -0.1;
  floor.receiveShadow = true;
  upright.position.y = 3;
  // Turned, so its edges run aslant across the pixels.
  upright.rotation.y = 0.35;
  upright.castShadow = true;
  studio.scene.add(floor, upright);
  studio.frame(new Vector3(-5, 0, 0), 10);
  studio.light(daylight([1, 0, 0.5]), theme(false), new Color(0.95, 0.95, 0.96));
  studio.render();

  return studio;
}

/** The picture on the canvas, as its red channel row by row. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
export function picture(opened: Studio): number[] {
  const gl = opened.renderer.getContext();
  const pixels = new Uint8Array(SIDE * SIDE * 4);

  gl.readPixels(0, 0, SIDE, SIDE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  return Array.from({ length: SIDE * SIDE }, (_, i) => pixels[i * 4] ?? 0);
}

/** The picture's mean over each block of 16 × 16 pixels: the occlusion pass's noise is drawn
 * anew for every studio, and averages out. */
function blocks(pixels: readonly number[]): number[] {
  const side = SIDE / 16;

  return Array.from({ length: side * side }, (_, block) => {
    const [left, top] = [(block % side) * 16, Math.floor(block / side) * 16];

    return mean(
      Array.from(
        { length: 256 },
        (__, i) => pixels[(top + Math.floor(i / 16)) * SIDE + left + (i % 16)] ?? 0,
      ),
    );
  });
}

/** The furthest two pictures' blocks lie apart, in levels of 255. */
export const apart = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...blocks(a).map((v, i) => Math.abs(v - (blocks(b)[i] ?? 0))));
