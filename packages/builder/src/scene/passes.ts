// The studio's passes for its 3D quality (ADR 20 Look, Rendering quality): the scene into
// multisampled HDR, ambient occlusion, the overlays over it, tone mapping, Ultra's burst of refining frames, and the
// lens glass over it all while the weather puts something on it (ADR 23).
import {
  type Fog,
  type Scene,
  type Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
  type OrthographicCamera,
  type PerspectiveCamera,
} from "three";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Composer } from "./composer.ts";
import { FocusPass, type Focus, type FocusFrame } from "./focus-pass.ts";
import { LensPass } from "./lens-pass.ts";
import { OcclusionPass } from "./occlusion-pass.ts";
import { Probe } from "./probe.ts";
import type { Look } from "./quality.ts";
import { jitter, Refiner } from "./refine.ts";
import type { Glass } from "./weather.ts";

export type { Focus } from "./focus-pass.ts";

export class Passes {
  readonly #renderer: WebGLRenderer;
  readonly #camera: PerspectiveCamera | OrthographicCamera;
  readonly #composer: Composer;
  readonly #occlusion: OcclusionPass;
  readonly #focus: FocusPass;
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

  /* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js draws with them. */
  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera | OrthographicCamera,
    fog: Fog,
    drawWeather: (source: WebGLRenderTarget, frame: FocusFrame) => void,
  ) {
    this.#renderer = renderer;
    this.#camera = camera;
    this.#composer = new Composer(renderer, scene, camera);
    this.#occlusion = new OcclusionPass(scene, camera, this.#composer.depth, fog);
    this.#focus = new FocusPass(camera, this.#composer.depth, (frame) => {
      drawWeather(this.#composer.scene, frame);
    });
    this.#composer.addPass(this.#occlusion);
    this.#composer.addPass(this.#focus);
    this.#composer.addPass(this.#composer.overlay);
    this.#composer.addPass(new OutputPass());
    // Last, and off while the lens is clear: the tone-mapped picture then goes to the canvas.
    this.#lens.enabled = false;
    this.#composer.addPass(this.#lens);
  }
  /* oxlint-enable typescript/prefer-readonly-parameter-types */

  /** Whether the ambient-occlusion pass runs. */
  get occlusion(): boolean {
    return this.#occlusion.enabled;
  }

  /** The target the scene pass draws into: a program differs by it. */
  get target(): WebGLRenderTarget {
    return this.#composer.scene;
  }

  focus(effects: Focus): void {
    this.#focus.show(effects);
  }

  frame(centre: Readonly<Vector3>, radius: number): void {
    this.#focus.frame(centre, radius);
  }

  /** The passes `look` asks for. */
  follow({ occlusion, occluded, samples, finest, glass }: Look): void {
    this.#occlusion.enabled = occlusion;
    this.#occluded = occluded;
    this.#occlusion.sample(samples);
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
    this.#focus.fit(width, height);
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

  /** Counts no more: the renderer is as it was before `measure`. */
  unmeasure(): void {
    this.#probe?.dispose();
    this.#probe = undefined;
  }

  /** Draws once with the enabled passes and the glass: each makes and first uses its programs. */
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
    this.#focus.dispose();
    this.#lens.dispose();
    this.#refiner.dispose();
    this.unmeasure();
  }
}
