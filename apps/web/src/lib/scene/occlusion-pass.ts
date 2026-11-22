import {
  DoubleSide,
  type DepthTexture,
  type Fog,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  type Texture,
  Uniform,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { VERTEX } from "./lens-shaders.ts";

const COMPOSITE = `
  #include <packing>

  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tOcclusion;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec3 fogColour;

  void main() {
    vec4 scene = texture2D(tScene, vUv);
    float depth = texture2D(tDepth, vUv).x;
    vec3 ao = texture2D(tOcclusion, vUv).rgb;
    float metres = -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    float fog = smoothstep(fogNear, fogFar, metres);

    // The scene already holds lit surfaces plus scattered light. Darken the surfaces alone.
    vec3 air = fogColour * fog;
    gl_FragColor = vec4(scene.rgb + (scene.rgb - air) * (ao - 1.0), scene.a);
    if (depth == 1.0) gl_FragColor = scene;
  }
`;

export class OcclusionPass extends GTAOPass {
  readonly #composite: FullScreenQuad;
  readonly #uniforms;
  readonly #fog: Fog;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with them.
  constructor(scene: Scene, camera: PerspectiveCamera, depth: DepthTexture, fog: Fog) {
    super(scene, camera, 1, 1);
    this.#fog = fog;
    this.output = GTAOPass.OUTPUT.Off;
    // The crate promises no winding. Draw both sides with the normal of the side seen.
    this.normalMaterial.side = DoubleSide;
    this.#uniforms = {
      tScene: new Uniform<Texture | null>(null),
      tDepth: { value: depth },
      tOcclusion: { value: this.gtaoMap },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      fogNear: { value: fog.near },
      fogFar: { value: fog.far },
      fogColour: { value: fog.color },
    };
    this.#composite = new FullScreenQuad(
      new ShaderMaterial({
        uniforms: this.#uniforms,
        vertexShader: VERTEX,
        fragmentShader: COMPOSITE,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  /** Wide and soft, with the sample count of the current 3D quality (ADR 20). */
  sample(samples: number): void {
    this.updateGtaoMaterial({
      radius: 2,
      distanceExponent: 1.5,
      thickness: 1.5,
      scale: 1.5,
      samples,
    });
    this.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 6,
      rings: 2,
      samples,
    });
  }

  /* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js draws with them. */
  override render(
    renderer: WebGLRenderer,
    write: WebGLRenderTarget,
    read: WebGLRenderTarget,
  ): void {
    super.render(renderer, write, read, 0, false);
    this.#uniforms.tScene.value = read.texture;
    this.#uniforms.fogNear.value = this.#fog.near;
    this.#uniforms.fogFar.value = this.#fog.far;
    renderer.setRenderTarget(write);
    this.#composite.render(renderer);
  }
  /* oxlint-enable typescript/prefer-readonly-parameter-types */

  override dispose(): void {
    super.dispose();
    this.#composite.material.dispose();
    this.#composite.dispose();
  }
}
