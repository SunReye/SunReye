// The studio's passes for its 3D quality (ADR 20 Look, Rendering quality): the scene into
// multisampled HDR, ambient occlusion, tone mapping, Ultra's burst of refining frames, and the
// lens glass over it all while the weather puts something on it (ADR 23).
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
import { LensPass } from "./lens-pass.ts";
import { Probe } from "./probe.ts";
import type { Look } from "./quality.ts";
import { jitter, Refiner } from "./refine.ts";
import type { Glass } from "./weather.ts";

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

  return pass;
}

/** The occlusion and its denoising, each from `samples` a pixel: a look's own (ADR 20). */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it in place.
function sample(pass: GTAOPass, samples: number): void {
  pass.updateGtaoMaterial({
    radius: 2,
    distanceExponent: 1.5,
    thickness: 1.5,
    scale: 1.5,
    samples,
  });
  pass.updatePdMaterial({
    lumaPhi: 10,
    depthPhi: 2,
    normalPhi: 3,
    radius: 6,
    rings: 2,
    samples,
  });
}

export class Passes {
  readonly #renderer: WebGLRenderer;
  readonly #camera: PerspectiveCamera;
  readonly #composer: EffectComposer;
  readonly #occlusion: GTAOPass;
  readonly #lens = new LensPass();
  readonly #refiner = new Refiner();
  #finest = false;
  /** The most device pixels the occlusion pass draws per CSS pixel: the look's. */
  #occluded = 1;
  /** Whether the look has the glass, and whether anything is on it. */
  #glass = false;
  #glazed = false;
  /** Counts each frame, once asked for (ADR 21 "Measuring"). */
  #probe: Probe | undefined;

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
    // Last, and off while the lens is clear: the tone-mapped picture then goes to the canvas.
    this.#lens.enabled = false;
    this.#composer.addPass(this.#lens);
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
  follow({ occlusion, occluded, samples, finest, glass }: Look): void {
    this.#occlusion.enabled = occlusion;
    this.#occluded = occluded;
    sample(this.#occlusion, samples);
    this.#finest = finest;
    this.#glass = glass;
    this.#lens.enabled = glass && this.#glazed;
  }

  /** What is on the lens at `seconds` of the weather loop; null for a clear one. */
  lens(glass: Glass | null, seconds: number): void {
    this.#glazed = glass !== null;
    this.#lens.enabled = this.#glass && this.#glazed;

    if (glass !== null) this.#lens.show(glass, seconds);
  }

  /** The glass's colours for the theme. */
  tint(dark: boolean): void {
    this.#lens.tint(dark);
  }

  setSize(width: number, height: number, ratio: number): void {
    // Occlusion is soft: it is drawn no finer than the look asks.
    const occluded = Math.min(ratio, this.#occluded);

    this.#composer.setPixelRatio(ratio);
    this.#composer.setSize(width, height);
    this.#occlusion.setSize(Math.round(width * occluded), Math.round(height * occluded));
    this.#lens.fit(width, height);
    this.#refiner.reset();
  }

  /** Draws the scene as it is now. */
  render(): void {
    this.#refiner.reset();

    if (this.#probe === undefined) this.#composer.render();
    else {
      this.#probe.frame(() => {
        this.#composer.render();
      });
    }
  }

  /** Counts what each frame draws from here on; `shadow` is the sun's shadow map. */
  measure(shadow: () => object | null, clock?: () => number): Probe {
    this.#probe ??= new Probe(this.#renderer, shadow, clock);

    return this.#probe;
  }

  /** Draws once with every pass, the glass too: each makes and first uses its programs. */
  warm(): void {
    const { enabled } = this.#lens;

    this.#lens.enabled = true;
    this.render();
    this.#lens.enabled = enabled;
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
    this.#composer.renderToScreen = false;
    this.#composer.render();
    this.#composer.renderToScreen = true;
    this.#camera.clearViewOffset();
    this.#refiner.add(this.#renderer, this.#composer.readBuffer.texture, width, height);

    return this.#refiner.due;
  }

  dispose(): void {
    this.#composer.dispose();
    this.#occlusion.dispose();
    this.#lens.dispose();
    this.#refiner.dispose();
    this.#probe?.dispose();
  }
}
