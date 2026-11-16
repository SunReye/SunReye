// The studio the scene is drawn in (ADR 20 Look): renderer, sun and moon, sky environment, a
// backdrop in the page colour, a lawn that fades into it, and the passes its 3D quality asks for.
// It draws only when asked: never in a loop.
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Object3D,
  type PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { toThree } from "../builder/scene.ts";
import { aim, backdrop, sky } from "./backdrop.ts";
import { CLEAR_SHADOW, untone, type Daylight, type Theme } from "./light.ts";
import { Passes } from "./passes.ts";
import { Plot } from "./plot.ts";
import { gpuOf, type Look } from "./quality.ts";
import { shade, shadowFor, soften } from "./sun-shadow.ts";
import { reweather, weatherFinishes } from "./weather.ts";

export class Studio {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();

  readonly #passes: Passes;
  #look: Look;
  /** The shadow's spread under the sky last lit: 1 when clear. */
  #spread = 1;
  readonly #sun = new DirectionalLight(0xffffff, 3);
  /** A faint sky and ground bounce on top of the image-based light; at night, the sky itself. */
  readonly #fill = new HemisphereLight();
  readonly #pmrem: PMREMGenerator;
  readonly #sky = sky(1000);
  readonly #skyScene = new Scene();
  readonly #plot = new Plot();
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

  /** `look` is asked once, with the GPU this canvas draws on, where the browser tells. */
  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws on it.
    canvas: HTMLCanvasElement,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
    camera: PerspectiveCamera,
    look: (gpu: string | null) => Look,
  ) {
    this.camera = camera;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.#look = look(gpuOf(this.renderer.getContext()));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.#pmrem = new PMREMGenerator(this.renderer);
    this.#skyScene.add(this.#sky);
    soften(this.#sun);
    this.scene.add(this.#sun, this.#sun.target, this.#fill, this.#plot.lawn);
    this.scene.fog = this.#plot.fog;

    this.#passes = new Passes(this.renderer, this.scene, camera);
    // Before the first frame: a finish is compiled for the look it is first drawn in.
    this.#apply();
  }

  /** Whether the ambient-occlusion pass runs. */
  get occlusion(): boolean {
    return this.#passes.occlusion;
  }

  /** Device pixels drawn per CSS pixel. */
  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio, this.#look.pixelRatio);
  }

  /** The sun's shadow map, in texels a side. */
  get shadowMap(): number {
    return this.#sun.shadow.mapSize.x;
  }

  /** Draws in `look` from the next frame on (ADR 20 Rendering quality). */
  follow(look: Look): void {
    if (look === this.#look) return;

    const before = this.#look;

    this.#look = look;
    this.#apply();
    this.setSize(...this.#size);

    if (before.weathering !== look.weathering) reweather(this.scene);
  }

  /** Fits the sun's shadow and the lawn's fade to the plot: `centre` in three.js's frame. */
  frame(centre: Readonly<Vector3>, radius: number): void {
    this.#centre.set(centre.x, centre.y, centre.z);
    this.#radius = Math.max(radius, 5);
    this.#plot.fit(centre.x, centre.z, this.#radius);

    const reach = this.#radius + 2;
    const camera = this.#sun.shadow.camera;

    Object.assign(camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    camera.near = 1;
    camera.far = this.#distance() * 2;
    camera.updateProjectionMatrix();
    this.#place();
    this.#shade();
  }

  /** Sun or moon, sky, environment, backdrop, fog and exposure for the time and the theme. */
  light(day: Daylight, look: Theme, page: Readonly<Color>): void {
    this.#toward.set(...toThree(day.toward));
    this.#sun.color.setRGB(day.colour.r, day.colour.g, day.colour.b);
    this.#sun.intensity = day.intensity;
    this.#spread = day.shadow / CLEAR_SHADOW;
    this.#shade();
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

    this.#plot.fog.color.copy(untoned);
  }

  setSize(width: number, height: number): void {
    this.#size = [width, height];
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.#passes.setSize(width, height, this.pixelRatio);
  }

  /** Draws the scene as it is now. */
  render(): void {
    this.#passes.render();
  }

  /** Ultra's burst: one more frame into the settled picture; true while more are due. */
  refine(): boolean {
    return this.#passes.refine();
  }

  /** Compiles what `part` needs for the target the scene pass draws into: a program differs by it. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js compiles it.
  compile(part: Object3D, scene: Scene = this.scene): void {
    this.renderer.setRenderTarget(this.#passes.target);
    this.renderer.compile(part, this.camera, scene);
    this.renderer.setRenderTarget(null);
  }

  /** The same for the whole scene, compiled in parallel; resolves once ready. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js compiles it.
  async compileAsync(scene: Scene = this.scene): Promise<void> {
    this.renderer.setRenderTarget(this.#passes.target);

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
    this.#passes.dispose();
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

  /** The look's passes, shadow map and finishes. */
  #apply(): void {
    this.#passes.follow(this.#look);
    weatherFinishes(this.#look.weathering);
    shadowFor(this.renderer, this.#sun, this.#look);
    this.#shade();
  }

  #shade(): void {
    shade(this.#sun, this.#look, this.#spread);
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
