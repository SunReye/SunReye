// The overlays drawn after the ambient occlusion (ADR 20 "Look"): into a multisampled target of
// their own, behind the scene where it stands before them, then laid over the picture.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js draws with them. */
import {
  AlwaysDepth,
  type Camera,
  Color,
  type DepthTexture,
  HalfFloatType,
  type Object3D,
  ShaderMaterial,
  type Texture,
  Uniform,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { VERTEX } from "./lens-shaders.ts";

/** The scene's depth, written as the target's own: an overlay behind a wall stays behind it. */
const DEPTH = `
  varying vec2 vUv;
  uniform sampler2D tDepth;

  void main() {
    gl_FragDepth = texture2D(tDepth, vUv).x;
  }
`;

/** The overlays, premultiplied by their cover, over the picture. */
const OVER = `
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tOverlay;

  void main() {
    vec4 scene = texture2D(tScene, vUv);
    vec4 overlay = texture2D(tOverlay, vUv);

    gl_FragColor = vec4(overlay.rgb + scene.rgb * (1.0 - overlay.a), scene.a);
  }
`;

export class OverlayPass extends Pass {
  readonly #camera: Camera;
  readonly #overlays: () => readonly Object3D[];
  readonly #target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  readonly #depth: FullScreenQuad;
  readonly #over: FullScreenQuad;
  readonly #scene = new Uniform<Texture | null>(null);
  readonly #clear = new Color();

  constructor(camera: Camera, depth: DepthTexture, overlays: () => readonly Object3D[]) {
    super();
    this.#camera = camera;
    this.#overlays = overlays;
    this.#depth = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: { tDepth: { value: depth } },
        vertexShader: VERTEX,
        fragmentShader: DEPTH,
        colorWrite: false,
        depthFunc: AlwaysDepth,
      }),
    );
    this.#over = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: { tScene: this.#scene, tOverlay: { value: this.#target.texture } },
        vertexShader: VERTEX,
        fragmentShader: OVER,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  override setSize(width: number, height: number): void {
    this.#target.setSize(width, height);
  }

  override render(
    renderer: WebGLRenderer,
    write: WebGLRenderTarget,
    read: WebGLRenderTarget,
  ): void {
    const overlays = this.#overlays();

    // Nothing over the picture: it stays where it is.
    this.needsSwap = overlays.length > 0;

    if (!this.needsSwap) return;

    const { autoClear } = renderer;
    const alpha = renderer.getClearAlpha();

    renderer.getClearColor(this.#clear);
    renderer.setRenderTarget(this.#target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    this.#depth.render(renderer);
    renderer.autoClear = false;

    try {
      for (const overlay of overlays) {
        overlay.visible = true;
        renderer.render(overlay, this.#camera);
        overlay.visible = false;
      }
    } finally {
      renderer.autoClear = autoClear;
      renderer.setClearColor(this.#clear, alpha);
    }

    this.#scene.value = read.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.#over.render(renderer);
  }

  override dispose(): void {
    this.#target.dispose();
    this.#depth.material.dispose();
    this.#depth.dispose();
    this.#over.material.dispose();
    this.#over.dispose();
  }
}
