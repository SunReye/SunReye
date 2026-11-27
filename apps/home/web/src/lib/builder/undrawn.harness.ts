// The builder's canvas without its pixels, for the component tests that read the page and the
// edits: a frame drawn in software on this GPU-less host costs most of a second.
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { vi } from "vitest";

/**
 * The canvas's frames counted, not drawn: each brings its scene and camera up to date as a draw
 * would, for the picking that reads them, and skips the pixels. A spy already on the composer
 * keeps its count and stops drawing. Restored by `vi.restoreAllMocks`. The journeys in
 * `Builder.svelte.test.ts` and the phone's still draw every frame.
 */
export function undrawn() {
  // oxlint-disable-next-line typescript/unbound-method -- only asked whether it is a spy already.
  const { render } = EffectComposer.prototype;
  const draws = vi.isMockFunction(render) ? render : vi.spyOn(EffectComposer.prototype, "render");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's composer, read.
  return draws.mockImplementation(function (this: EffectComposer) {
    for (const pass of this.passes) {
      if (pass instanceof RenderPass) {
        pass.scene.updateMatrixWorld();
        pass.camera.updateMatrixWorld();
      }
    }
  });
}
