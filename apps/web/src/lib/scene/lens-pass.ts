// The lens glass (ADR 23 "Scene weather"): one pass after tone mapping. Rain beads and runs on
// it and bends the picture; snow settles at its edges and melts; frost creeps in from the
// corners. It only draws over the finished picture: the canvas, the camera and so every label
// and pointer cast through them are as without it.
import {
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { FIELD, GLASS, VERTEX } from "./lens-shaders.ts";
import type { Glass } from "./weather.ts";

/** The field is drawn at this share of the picture's CSS size: beads and frost are soft. */
const REDUCED = 0.5;

/** The picture's shorter side, in CSS pixels, from which a bead is as large as it gets: on a
 * smaller picture the glass shrinks with it, down to `SMALLEST` of its size. */
const FULL_SIDE = 480;
const SMALLEST = 0.4;

/** The most the glass bends the picture, in its own units. */
const BEND = 14;

/** A drop's shade and the white of snow and frost, as they land on screen by theme: never
 * glowing on the dark page, and apart from the light one. */
const SHADE = {
  light: { shade: 0.45, white: [0.78, 0.84, 0.93] },
  dark: { shade: 0.48, white: [0.36, 0.4, 0.47] },
} as const;

/** Seconds after which the glass's clock starts over: a shader counts in 32 bits, and after
 * days of the loop a running drop would move in steps. Once an hour the beads are other ones. */
const TURN = 3600;

const quiet = { depthTest: false, depthWrite: false } as const;

/** A uniform that holds a texture once there is one. */
interface Sampler {
  value: Texture | null;
}

const sampler = (): Sampler => ({ value: null });

export class LensPass extends Pass {
  readonly #fieldUniforms = {
    uSize: { value: new Vector2(1, 1) },
    uSeconds: { value: 0 },
    uGlass: { value: new Vector3() },
  };
  readonly #glassUniforms = {
    tDiffuse: sampler(),
    tField: sampler(),
    uBend: { value: new Vector2() },
    uShade: { value: 0 },
    uWhite: { value: new Vector3() },
  };
  readonly #field = new FullScreenQuad(
    new ShaderMaterial({
      uniforms: this.#fieldUniforms,
      vertexShader: VERTEX,
      fragmentShader: FIELD,
      ...quiet,
    }),
  );
  readonly #glass = new FullScreenQuad(
    new ShaderMaterial({
      uniforms: this.#glassUniforms,
      vertexShader: VERTEX,
      fragmentShader: GLASS,
      ...quiet,
    }),
  );
  readonly #target = new WebGLRenderTarget(1, 1, { depthBuffer: false });
  /** What the field was last drawn for: it is drawn again only for another. */
  #drawn = "";

  constructor() {
    super();
    this.#glassUniforms.tField.value = this.#target.texture;
    this.tint(false);
  }

  /** What is on the lens at `seconds` of the weather loop. */
  show({ rain, snow, frost }: Glass, seconds: number): void {
    this.#fieldUniforms.uGlass.value.set(rain, snow, frost);
    this.#fieldUniforms.uSeconds.value = seconds % TURN;
  }

  /** The glass's colours for the theme. */
  tint(dark: boolean): void {
    const { shade, white } = dark ? SHADE.dark : SHADE.light;

    this.#glassUniforms.uShade.value = shade;
    this.#glassUniforms.uWhite.value.fromArray(white);
  }

  /** Fits the glass to a picture of `width` by `height` CSS pixels. */
  fit(width: number, height: number): void {
    const scale = Math.min(1, Math.max(SMALLEST, Math.min(width, height) / FULL_SIDE));
    const [wide, high] = [width / scale, height / scale];

    this.#fieldUniforms.uSize.value.set(wide, high);
    this.#glassUniforms.uBend.value.set(BEND / wide, BEND / high);
    this.#target.setSize(
      Math.max(1, Math.round(width * REDUCED)),
      Math.max(1, Math.round(height * REDUCED)),
    );
    this.#drawn = "";
  }

  /* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js draws with them. */
  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    const { uGlass, uSeconds } = this.#fieldUniforms;
    const drawn = JSON.stringify([uGlass.value.toArray(), uSeconds.value]);

    if (drawn !== this.#drawn) {
      this.#drawn = drawn;
      renderer.setRenderTarget(this.#target);
      this.#field.render(renderer);
    }

    this.#glassUniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.#glass.render(renderer);
  }
  /* oxlint-enable typescript/prefer-readonly-parameter-types */

  override dispose(): void {
    this.#target.dispose();
    this.#field.material.dispose();
    this.#field.dispose();
    this.#glass.material.dispose();
    this.#glass.dispose();
  }
}
