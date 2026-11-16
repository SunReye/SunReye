// The studio's passes for its 3D quality (ADR 20 Look, Rendering quality): the scene into
// multisampled HDR, ambient occlusion, tone mapping, and Ultra's burst of refining frames.
import {
  DoubleSide,
  HalfFloatType,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import type { Look } from "./quality.ts";
import { jitter, Refiner } from "./refine.ts";

/** One ambient-occlusion pass, wide and strong: on a white model it is what sets a wall on the
 * ground and an eave on its wall. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js reads them.
function ambientOcclusion(scene: Scene, camera: PerspectiveCamera): GTAOPass {
  const pass = new GTAOPass(scene, camera, 1, 1);

  // The pass draws the scene's depths and normals with a material of its own, which culls a
  // face wound away from the camera: what stands behind it would then shade it, a wall's edge
  // showing through its roof. The crate promises no winding, so both sides are drawn, each
  // with the normal of the side seen.
  pass.normalMaterial.side = DoubleSide;

  pass.blendIntensity = 1;
  pass.updateGtaoMaterial({
    radius: 2,
    distanceExponent: 1.5,
    thickness: 1.5,
    scale: 1.5,
    samples: 12,
  });
  pass.updatePdMaterial({
    lumaPhi: 10,
    depthPhi: 2,
    normalPhi: 3,
    radius: 6,
    rings: 2,
    samples: 12,
  });

  return pass;
}

/** The most device pixels the occlusion pass draws per CSS pixel below Ultra: Mittel's. */
const OCCLUSION_RATIO = 1.5;

export class Passes {
  readonly #renderer: WebGLRenderer;
  readonly #camera: PerspectiveCamera;
  readonly #composer: EffectComposer;
  readonly #occlusion: GTAOPass;
  readonly #refiner = new Refiner();
  #finest = false;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with them.
  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    this.#renderer = renderer;
    this.#camera = camera;
    // Multisampled HDR, then ambient occlusion, then tone mapping and sRGB.
    this.#composer = new EffectComposer(
      renderer,
      new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }),
    );
    this.#occlusion = ambientOcclusion(scene, camera);
    this.#composer.addPass(new RenderPass(scene, camera));
    this.#composer.addPass(this.#occlusion);
    this.#composer.addPass(new OutputPass());
  }

  /** Whether the ambient-occlusion pass runs. */
  get occlusion(): boolean {
    return this.#occlusion.enabled;
  }

  /** The target the scene pass draws into: a program differs by it. */
  get target(): WebGLRenderTarget {
    return this.#composer.readBuffer;
  }

  /** The passes `look` asks for. */
  follow({ occlusion, finest }: Look): void {
    this.#occlusion.enabled = occlusion;
    this.#finest = finest;
  }

  setSize(width: number, height: number, ratio: number): void {
    // Occlusion is soft: below Ultra it is drawn no finer than Mittel draws it.
    const occluded = this.#finest ? ratio : Math.min(ratio, OCCLUSION_RATIO);

    this.#composer.setPixelRatio(ratio);
    this.#composer.setSize(width, height);
    this.#occlusion.setSize(Math.round(width * occluded), Math.round(height * occluded));
    this.#refiner.reset();
  }

  /** Draws the scene as it is now. */
  render(): void {
    this.#refiner.reset();
    this.#composer.render();
  }

  /**
   * Ultra's temporal antialiasing: draws the settled picture once more, a fraction of a pixel
   * aside, and shows the mean of the burst so far. True while the burst has frames to go; a
   * `render` starts it over.
   */
  refine(): boolean {
    if (!this.#finest || !this.#refiner.due) return false;

    const { width, height } = this.#composer.readBuffer;
    const [x, y] = jitter(this.#refiner.taken);

    this.#camera.setViewOffset(width, height, x, y, width, height);
    // Nothing moved: the shadow map of the settled frame holds.
    this.#renderer.shadowMap.autoUpdate = false;
    this.#composer.renderToScreen = false;
    this.#composer.render();
    this.#composer.renderToScreen = true;
    this.#renderer.shadowMap.autoUpdate = true;
    this.#camera.clearViewOffset();
    this.#refiner.add(this.#renderer, this.#composer.readBuffer.texture, width, height);

    return this.#refiner.due;
  }

  dispose(): void {
    this.#composer.dispose();
    this.#occlusion.dispose();
    this.#refiner.dispose();
  }
}
