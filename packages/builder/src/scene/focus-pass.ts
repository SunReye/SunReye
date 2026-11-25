import type { Lens } from "../builder/lens.ts";
import { DEPTH_METRES, depthDefines } from "./depth-metres.ts";
import {
  type DepthTexture,
  HalfFloatType,
  MathUtils,
  ShaderMaterial,
  type Texture,
  Uniform,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { FOCUS_MODEL, type Focus, type FocusFrame } from "./focus-shader.ts";
import { VERTEX } from "./lens-shaders.ts";

export type { Focus, FocusFrame } from "./focus-shader.ts";

const PREFILTER = `
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform vec2 texel;

  void main() {
    vec2 offset = texel * 0.85;
    gl_FragColor = 0.25 * (
      texture2D(tScene, vUv + offset) + texture2D(tScene, vUv - offset) +
      texture2D(tScene, vUv + vec2(offset.x, -offset.y)) +
      texture2D(tScene, vUv + vec2(-offset.x, offset.y))
    );
  }
`;

const BLUR = `
  #include <packing>
  ${DEPTH_METRES}
  ${FOCUS_MODEL}

  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tSoft;
  uniform sampler2D tDepth;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform vec2 maxBlur;
  uniform vec2 texel;

  float blurAt(vec2 uv) {
    if (!depthOfField) return focusBlur(0.0, uv.y);
    float depth = texture2D(tDepth, uv).x;
    float metres = metresAt(depth, cameraNear, cameraFar);
    return focusBlur(metres, uv.y);
  }

  vec4 colourAt(vec2 uv, float soft) {
    if (soft >= 1.0) return texture2D(tSoft, uv);
    if (soft <= 0.0) return texture2D(tScene, uv);

    return mix(texture2D(tScene, uv), texture2D(tSoft, uv), soft);
  }

  void main() {
    vec4 scene = texture2D(tScene, vUv);
    float blur = blurAt(vUv);
    if (blur == 0.0) {
      gl_FragColor = scene;
      return;
    }

    float soft = smoothstep(2.0, 6.0, blur * maxBlur.x / texel.x);
    vec4 sum = colourAt(vUv, soft);
    float total = 1.0;

    // Even rings of the round aperture. Prefiltering joins adjacent samples into a filled disc.
    for (int ring = 1; ring <= 3; ring++) {
      float radius = blur * float(ring) / 3.2;
      float step = 6.2831853 / float(ring * 6);
      for (int i = 0; i < 18; i++) {
        if (i >= ring * 6) break;

        float angle = (float(i) + float(ring) * 0.35) * step;
        vec2 uv = clamp(vUv + vec2(cos(angle), sin(angle)) * maxBlur * radius, 0.0, 1.0);
        float weight = smoothstep(0.0, 0.15, blurAt(uv) - radius + 0.15);
        sum += colourAt(uv, soft) * weight;
        total += weight;
      }
    }
    gl_FragColor = sum / total;
  }
`;

export class FocusPass extends Pass {
  readonly #camera: Lens;
  readonly #drawOver: (frame: FocusFrame) => void;
  readonly #quad: FullScreenQuad;
  readonly #prefilter: FullScreenQuad;
  readonly #soft = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  readonly #uniforms;
  readonly #centre = new Vector3();
  readonly #point = new Vector3();

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read each frame.
    camera: Lens,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- sampled by the shader.
    depth: DepthTexture,
    drawOver: (frame: FocusFrame) => void,
  ) {
    super();
    this.enabled = false;
    this.#camera = camera;
    this.#drawOver = drawOver;
    this.#uniforms = {
      tScene: new Uniform<Texture | null>(null),
      tSoft: { value: this.#soft.texture },
      tDepth: { value: depth },
      tiltShift: { value: false },
      depthOfField: { value: false },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      focusDepth: { value: 1 },
      focusY: { value: 0.5 },
      plotRadius: { value: 10 },
      maxBlur: { value: new Vector2() },
      texel: { value: new Vector2() },
    };
    this.#quad = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: this.#uniforms,
        vertexShader: VERTEX,
        defines: depthDefines(camera),
        fragmentShader: BLUR,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.#prefilter = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: { tScene: this.#uniforms.tScene, texel: this.#uniforms.texel },
        vertexShader: VERTEX,
        fragmentShader: PREFILTER,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  show({ tiltShift, depthOfField }: Focus): void {
    this.enabled = tiltShift || depthOfField;
    this.#uniforms.tiltShift.value = tiltShift;
    this.#uniforms.depthOfField.value = depthOfField;
  }

  frame(centre: Readonly<Vector3>, radius: number): void {
    this.#centre.set(centre.x, centre.y, centre.z);
    this.#uniforms.plotRadius.value = radius;
  }

  fit(width: number, height: number): void {
    const pixels = Math.min(Math.min(width, height) * 0.045, 16);

    this.#uniforms.maxBlur.value.set(pixels / Math.max(width, 1), pixels / Math.max(height, 1));
  }

  /* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js draws with them. */
  override render(
    renderer: WebGLRenderer,
    write: WebGLRenderTarget,
    read: WebGLRenderTarget,
  ): void {
    const camera = this.#camera;
    const point = this.#point.copy(this.#centre).applyMatrix4(camera.matrixWorldInverse);

    this.#uniforms.focusDepth.value = Math.max(camera.near, -point.z);
    this.#uniforms.focusY.value = MathUtils.clamp(
      (point.applyMatrix4(camera.projectionMatrix).y + 1) / 2,
      0,
      1,
    );
    this.#uniforms.tScene.value = read.texture;
    this.#uniforms.texel.value.set(1 / read.width, 1 / read.height);
    this.#soft.setSize(Math.ceil(read.width / 3), Math.ceil(read.height / 3));
    renderer.setRenderTarget(this.#soft);
    this.#prefilter.render(renderer);
    renderer.setRenderTarget(write);
    this.#quad.render(renderer);
    this.#drawOver({
      tiltShift: this.#uniforms.tiltShift.value,
      depthOfField: this.#uniforms.depthOfField.value,
      focusDepth: this.#uniforms.focusDepth.value,
      focusY: this.#uniforms.focusY.value,
      plotRadius: this.#uniforms.plotRadius.value,
      blurPixels: this.#uniforms.maxBlur.value.x * write.width,
    });
  }
  /* oxlint-enable typescript/prefer-readonly-parameter-types */

  override dispose(): void {
    this.#prefilter.material.dispose();
    this.#prefilter.dispose();
    this.#soft.dispose();
    this.#quad.material.dispose();
    this.#quad.dispose();
  }
}
