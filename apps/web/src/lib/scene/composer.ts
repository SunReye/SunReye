// The studio's composer (ADR 20 Look, Rendering quality): the scene is drawn into a multisampled
// target of its own, and every pass after it into one of two that have no samples.
import {
  type Camera,
  DepthTexture,
  HalfFloatType,
  type Scene,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";

/**
 * three.js's composer clones one target for both of its buffers, so a multisampled scene makes
 * every later pass fill and resolve samples too, where it draws one flat picture over another.
 * Here each frame starts by reading the scene's own target, which the scene pass draws into, and
 * the passes after it swap between the two plain ones.
 */
export class Composer extends EffectComposer {
  readonly depth = new DepthTexture(1, 1);
  /** What the scene pass draws into: multisampled HDR and depth for the post passes. */
  readonly scene = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    samples: 4,
    depthTexture: this.depth,
  });

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    super(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType }));
    this.addPass(new RenderPass(scene, camera));
  }

  override render(deltaTime?: number): void {
    this.readBuffer = this.scene;
    this.writeBuffer = this.renderTarget1;
    super.render(deltaTime);
  }

  /** As three.js's, but the scene's target is read once and never written. */
  override swapBuffers(): void {
    const read = this.readBuffer;

    this.readBuffer = this.writeBuffer;
    this.writeBuffer = read === this.scene ? this.renderTarget2 : read;
  }

  override setSize(width: number, height: number): void {
    super.setSize(width, height);
    this.scene.setSize(this.renderTarget1.width, this.renderTarget1.height);
  }

  override dispose(): void {
    super.dispose();
    this.scene.dispose();
  }
}
