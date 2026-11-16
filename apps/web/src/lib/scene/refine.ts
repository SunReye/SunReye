// Ultra's temporal antialiasing (ADR 20 Look, Rendering quality): once the picture has settled,
// a short burst of frames, each drawn a fraction of a pixel aside, is averaged into it; then
// drawing stops again. There is still no loop.
import {
  HalfFloatType,
  NoBlending,
  NormalBlending,
  ShaderMaterial,
  type Texture,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/** Frames averaged: about a quarter of a second at 60 Hz. */
export const SAMPLES = 16;

/** Halton's sequence in `base`: the points of a burst fill a pixel evenly, however many are drawn. */
function halton(index: number, base: number): number {
  let [fraction, result] = [1, 0];

  for (let i = index; i > 0; i = Math.floor(i / base)) {
    fraction /= base;
    result += fraction * (i % base);
  }

  return result;
}

/** Where sample `index` is drawn, in pixels off the settled picture: the first lies on it. */
export function jitter(index: number): readonly [number, number] {
  return index === 0 ? [0, 0] : [halton(index, 2) - 0.5, halton(index, 3) - 0.5];
}

const VERTEX = `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

/** A share of a frame, whatever its own alpha: blended over the mean, it is that share of it. */
const FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float opacity;
varying vec2 vUv;
void main() {
	gl_FragColor = vec4( texture2D( tDiffuse, vUv ).rgb, opacity );
}`;

/** Averages the frames of a burst and puts the mean on the canvas. */
export class Refiner {
  readonly #copy = new ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, opacity: { value: 1 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  readonly #quad = new FullScreenQuad(this.#copy);
  #mean: WebGLRenderTarget | undefined;
  #taken = 0;

  /** Frames averaged since the picture last changed. */
  get taken(): number {
    return this.#taken;
  }

  /** Whether the burst has frames to go. */
  get due(): boolean {
    return this.#taken < SAMPLES;
  }

  /** The picture changed: the next burst starts over. */
  reset(): void {
    this.#taken = 0;
  }

  /** Takes `frame`, as drawn at `jitter(this.taken)`, into the mean and shows the mean. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with them.
  add(renderer: WebGLRenderer, frame: Texture, width: number, height: number): void {
    const mean = this.#sized(width, height);
    const cleared = renderer.autoClear;

    this.#taken += 1;
    renderer.autoClear = false;
    this.#draw(renderer, frame, 1 / this.#taken, mean);
    this.#draw(renderer, mean.texture, 1, null);
    renderer.autoClear = cleared;
  }

  dispose(): void {
    this.#mean?.dispose();
    this.#copy.dispose();
    this.#quad.dispose();
  }

  #sized(width: number, height: number): WebGLRenderTarget {
    this.#mean ??= new WebGLRenderTarget(width, height, {
      type: HalfFloatType,
      depthBuffer: false,
    });

    if (this.#mean.width !== width || this.#mean.height !== height) {
      this.#mean.setSize(width, height);
    }

    return this.#mean;
  }

  /* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js draws with them. */
  #draw(
    renderer: WebGLRenderer,
    from: Texture,
    share: number,
    into: WebGLRenderTarget | null,
  ): void {
    Object.assign(this.#copy.uniforms["tDiffuse"] ?? {}, { value: from });
    Object.assign(this.#copy.uniforms["opacity"] ?? {}, { value: share });
    // The whole picture replaces what is there; a share of it blends in.
    this.#copy.blending = share === 1 ? NoBlending : NormalBlending;
    renderer.setRenderTarget(into);
    this.#quad.render(renderer);
    renderer.setRenderTarget(null);
  }
  /* oxlint-enable typescript/prefer-readonly-parameter-types */
}
