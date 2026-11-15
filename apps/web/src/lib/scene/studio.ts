// The studio the scene is drawn in (ADR 20 Look): renderer, sun and moon, sky environment, a
// backdrop in the page colour, a lawn that fades into it, and one ambient-occlusion pass. It draws
// only when asked: never in a loop.
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HalfFloatType,
  HemisphereLight,
  type Object3D,
  PCFShadowMap,
  type PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { toThree } from "../builder/scene.ts";
import type { MotionTier } from "../motion/tier.ts";
import { aim, backdrop, ground, sky } from "./backdrop.ts";
import { occlusion, untone, type Daylight, type Theme } from "./light.ts";
import { weatherFinishes } from "./weather.ts";

/** Soft shadows: PCF with a radius, as r187 dropped PCFSoftShadowMap. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it up in place.
function soften(sun: DirectionalLight): void {
  const shadow = sun.shadow;

  sun.castShadow = true;
  shadow.mapSize.set(2048, 2048);
  shadow.bias = -0.00025;
  shadow.normalBias = 0.035;
  shadow.blurSamples = 16;
}

/** One ambient-occlusion pass, as the prototype tuned it. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js reads them.
function ambientOcclusion(scene: Scene, camera: PerspectiveCamera): GTAOPass {
  const pass = new GTAOPass(scene, camera, 1, 1);

  pass.blendIntensity = 0.9;
  pass.updateGtaoMaterial({
    radius: 0.7,
    distanceExponent: 1.5,
    thickness: 1.5,
    scale: 1,
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

export class Studio {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();

  readonly #composer: EffectComposer;
  readonly #occlusion: GTAOPass;
  readonly #sun = new DirectionalLight(0xffffff, 3);
  /** A faint sky and ground bounce on top of the image-based light; at night, the sky itself. */
  readonly #fill = new HemisphereLight();
  readonly #pmrem: PMREMGenerator;
  readonly #sky = sky(1000);
  readonly #skyScene = new Scene();
  readonly #fade = { centre: { value: new Vector2() }, radius: { value: 12 } };
  #environment: WebGLRenderTarget | undefined;
  /** What the environment and the backdrop were made for: either is made again only on change. */
  #environed = "";
  #backdrop: Texture | undefined;
  #backdropped = "";
  /** The plot's centre in three.js's frame and its radius in metres. */
  readonly #centre = new Vector3();
  #radius = 10;
  readonly #toward = new Vector3(0, 1, 0);
  readonly camera: PerspectiveCamera;
  /** The environment waits for `environ`: made at once, it would compile its programs blocking. */
  #held: readonly [Daylight, Theme] | null | undefined = null;
  #size: readonly [number, number] = [1, 1];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws on them.
  constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera, tier: MotionTier) {
    this.camera = camera;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.#pmrem = new PMREMGenerator(this.renderer);
    this.#skyScene.add(this.#sky);
    soften(this.#sun);
    this.scene.add(this.#sun, this.#sun.target, this.#fill, ground(this.#fade));

    // Multisampled HDR, then ambient occlusion, then tone mapping and sRGB.
    this.#composer = new EffectComposer(
      this.renderer,
      new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }),
    );
    this.#occlusion = ambientOcclusion(this.scene, camera);
    this.#composer.addPass(new RenderPass(this.scene, camera));
    this.#composer.addPass(this.#occlusion);
    this.#composer.addPass(new OutputPass());
    // Before the first frame: a finish is compiled for the tier it is first drawn on.
    this.follow(tier);
  }

  /** Whether the ambient-occlusion pass runs. */
  get occlusion(): boolean {
    return this.#occlusion.enabled;
  }

  /** Ambient occlusion and the finishes' extras run on the full motion tier only (ADR 21). */
  follow(tier: MotionTier): void {
    this.#occlusion.enabled = occlusion(tier);
    weatherFinishes(tier === "full");
  }

  /** Fits the sun's shadow and the lawn's fade to the plot: `centre` in three.js's frame. */
  frame(centre: Readonly<Vector3>, radius: number): void {
    this.#centre.set(centre.x, centre.y, centre.z);
    this.#radius = Math.max(radius, 5);
    this.#fade.centre.value.set(centre.x, centre.z);
    this.#fade.radius.value = this.#radius;

    const reach = this.#radius + 2;
    const camera = this.#sun.shadow.camera;

    Object.assign(camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    camera.near = 1;
    camera.far = this.#distance() * 2;
    camera.updateProjectionMatrix();
    this.#place();
  }

  /** Sun or moon, sky, environment, backdrop, fog and exposure for the time and the theme. */
  light(day: Daylight, look: Theme, page: Readonly<Color>): void {
    this.#toward.set(...toThree(day.toward));
    this.#sun.color.setRGB(day.colour.r, day.colour.g, day.colour.b);
    this.#sun.intensity = day.intensity;
    this.#sun.shadow.radius = day.shadow;
    this.#fill.color.setRGB(day.fill.sky.r, day.fill.sky.g, day.fill.sky.b);
    this.#fill.groundColor.setRGB(day.fill.ground.r, day.fill.ground.g, day.fill.ground.b);
    this.#fill.intensity = day.fill.intensity;
    this.#place();

    if (this.#held === undefined) this.#environ(day, look);
    else this.#held = [day, look];

    const untoned = new Color(
      untone(page.r, look.exposure),
      untone(page.g, look.exposure),
      untone(page.b, look.exposure),
    );

    const backdropped = JSON.stringify([page.r, page.g, page.b, look]);

    this.renderer.toneMappingExposure = look.exposure;

    if (backdropped !== this.#backdropped) {
      this.#backdropped = backdropped;
      this.#backdrop?.dispose();
      this.#backdrop = backdrop(new Color(page.r, page.g, page.b), look.exposure, look.dark);
      this.scene.background = this.#backdrop;
    }

    // Far ground and trees melt into the page colour.
    this.scene.fog = new Fog(untoned, this.#radius * 4 + 40, this.#radius * 16 + 160);
  }

  setSize(width: number, height: number): void {
    this.#size = [width, height];
    this.renderer.setSize(width, height, false);
    this.#composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#composer.setSize(width, height);
  }

  render(): void {
    this.#composer.render();
  }

  /** Compiles what `part` needs for the target the scene pass draws into: a program differs by it. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js compiles it.
  compile(part: Object3D, scene: Scene = this.scene): void {
    this.renderer.setRenderTarget(this.#composer.readBuffer);
    this.renderer.compile(part, this.camera, scene);
    this.renderer.setRenderTarget(null);
  }

  /** The same for the whole scene, compiled in parallel; resolves once ready. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js compiles it.
  async compileAsync(scene: Scene = this.scene): Promise<void> {
    this.renderer.setRenderTarget(this.#composer.readBuffer);

    const ready = this.renderer.compileAsync(scene, this.camera, scene);

    this.renderer.setRenderTarget(null);
    await ready;
  }

  /** Makes the environment held since: its programs first, used on a map of a few pixels. */
  async environ(): Promise<void> {
    await this.compileAsync(this.#skyScene);
    this.#pmrem.fromScene(this.#skyScene, 0, 0.1, 2000, { size: 16 }).dispose();

    const held = this.#held;

    this.#held = undefined;

    if (held !== null && held !== undefined) this.#environ(...held);
  }

  /** A frame of a few pixels: every pass makes and first uses its programs. */
  warm(): void {
    const [width, height] = this.#size;

    this.setSize(4, 4);
    this.render();
    this.setSize(width, height);
  }

  dispose(): void {
    this.#composer.dispose();
    this.#occlusion.dispose();
    this.#environment?.dispose();
    this.#backdrop?.dispose();
    this.#pmrem.dispose();
    this.renderer.dispose();
  }

  /**
   * The sky model at the sun, as the scene's environment. Made again only once the sun has moved
   * a degree, the clouds have changed or the theme has: a dragged time slider moves it by far
   * less per step.
   */
  #environ(day: Daylight, { dark, environment }: Theme): void {
    const environed = JSON.stringify([
      day.sun.map((v) => Math.round(v * 60)),
      dark,
      Math.round(day.clouds.coverage * 20),
    ]);

    this.scene.environmentIntensity = day.environment * environment;

    if (environed === this.#environed) return;

    this.#environed = environed;
    aim(this.#sky, new Vector3(...toThree(day.sun)), {
      dark,
      low: day.haze,
      clouds: day.clouds,
    });
    this.#environment?.dispose();
    this.#environment = this.#pmrem.fromScene(this.#skyScene, 0, 0.1, 2000);
    this.scene.environment = this.#environment.texture;
  }

  #distance(): number {
    return this.#radius * 3 + 20;
  }

  #place(): void {
    this.#sun.target.position.copy(this.#centre);
    this.#sun.position.copy(this.#centre).addScaledVector(this.#toward, this.#distance());
    this.#sun.target.updateMatrixWorld();
  }
}
