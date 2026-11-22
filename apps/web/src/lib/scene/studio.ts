// The studio the scene is drawn in (ADR 20 Look): renderer, sun and moon, sky environment, a
// backdrop in the page colour, a floor that fades into it, and the passes its 3D quality asks for.
// It draws only when asked: the loop is the weather's (ADR 23 "Motion"), and not the studio's.
import {
  type Color,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  type Object3D,
  type PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { toThree } from "../builder/scene.ts";
import { Environment } from "./environment.ts";
import { Fall } from "./falling.ts";
import type { Daylight, Theme } from "./light.ts";
import { Passes, type Focus } from "./passes.ts";
import { Plot } from "./plot.ts";
import { gpuOf, type Look } from "./quality.ts";
import { shade, shadowFor, soften } from "./sun-shadow.ts";
import { DRY, fogColour, type Falling, type Glass, type SceneWeather } from "./weather.ts";

export class Studio {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();

  readonly #passes: Passes;
  #look: Look;
  readonly #sun = new DirectionalLight(0xffffff, 3);
  /** A faint sky and ground bounce on top of the image-based light; at night, the sky itself. */
  readonly #fill = new HemisphereLight();
  readonly #environment: Environment;
  readonly #plot = new Plot();
  /** Rain and snow in the air: the studio's own, like the floor, and no part of what is built. */
  readonly #fall = new Fall();
  /** The plot's centre in three.js's frame and its radius in metres. */
  readonly #centre = new Vector3();
  #radius = 10;
  readonly #toward = new Vector3(0, 1, 0);
  readonly camera: PerspectiveCamera;
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
      // The scene is antialiased in its own target (passes.ts); the canvas takes the picture alone.
      antialias: false,
      powerPreference: "high-performance",
    });
    this.#look = look(gpuOf(this.renderer.getContext()));
    this.renderer.shadowMap.enabled = true;
    // Drawn on `recast` alone (ADR 20 Rendering): three.js would draw it with every render, the
    // occlusion's own among them, under a sun that stands still.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.#environment = new Environment(this.renderer, this.scene);
    soften(this.#sun);
    this.scene.add(this.#sun, this.#sun.target, this.#fill, this.#plot.floor, this.#fall.object);
    this.scene.fog = this.#plot.fog;

    this.#passes = new Passes(
      this.renderer,
      this.scene,
      camera,
      this.#plot.fog,
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the pass samples the target's texture.
      (source, frame) => {
        this.#fall.drawOver(this.renderer, camera, source, frame);
      },
    );
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

  /** What it draws now. */
  // fallow-ignore-next-line unused-class-member -- the readout reads it through the perf store.
  get look(): Look {
    return this.#look;
  }

  /** The sun's shadow map, in texels a side. */
  get shadowMap(): number {
    return this.#sun.shadow.mapSize.x;
  }

  /** Draws in `look` from the next frame on (ADR 20 Rendering quality). */
  follow(look: Look): void {
    if (look === this.#look) return;

    this.#look = look;
    this.#apply();
    this.setSize(...this.#size);
  }

  /** Fits the sun's shadow and the floor's fade to the plot: `centre` in three.js's frame. */
  frame(centre: Readonly<Vector3>, radius: number): void {
    this.#centre.set(centre.x, centre.y, centre.z);
    this.#radius = Math.max(radius, 5);
    this.#plot.fit(centre.x, centre.z, this.#radius);
    this.#fall.fit(centre.x, centre.z, this.#radius);
    this.#passes.frame(centre, this.#radius);

    const reach = this.#radius + 2;
    const camera = this.#sun.shadow.camera;

    Object.assign(camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    camera.near = 1;
    camera.far = this.#distance() * 2;
    camera.updateProjectionMatrix();
    this.#place();
    this.#shade();
    this.recast();
  }

  /** What casts a shadow changed, or where from: the sun's shadow map is drawn again with the
   * next frame. */
  recast(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Sun or moon, sky, environment, backdrop, fog and exposure for the time and the theme, and
   * the `weather`'s fog, which greys backdrop and fog alike, and floor (ADR 23). */
  light(day: Daylight, look: Theme, page: Readonly<Color>, weather?: SceneWeather): void {
    const toward = toThree(day.toward);

    // The map is the sun's view: its colour and strength are not in it.
    if (!this.#toward.equals({ x: toward[0], y: toward[1], z: toward[2] })) this.recast();

    this.#toward.set(...toward);
    this.#sun.color.setRGB(day.colour.r, day.colour.g, day.colour.b);
    this.#sun.intensity = day.intensity;
    this.#sun.shadow.intensity = day.shadow;
    this.#fill.color.setRGB(day.fill.sky.r, day.fill.sky.g, day.fill.sky.b);
    this.#fill.groundColor.setRGB(day.fill.ground.r, day.fill.ground.g, day.fill.ground.b);
    this.#fill.intensity = day.fill.intensity;
    this.#place();

    // The air's colour: the page's, greyed by the weather's fog, a twentieth at a time.
    const given = weather ?? DRY;
    const air = fogColour([page.r, page.g, page.b], look.dark, Math.round(given.fog * 20) / 20);

    this.renderer.toneMappingExposure = look.exposure;
    this.#environment.light(day, look, air);
    this.#plot.weather(given, air, look.exposure);
    this.#fall.tint(look.dark, look.exposure);
    this.#passes.tint(look.dark);
  }

  /** What is on the lens at `seconds` of the weather loop (ADR 23); null for a clear one. The
   * look decides whether it is drawn: not at Niedrig, and on the full tier alone. */
  lens(glass: Glass | null, seconds: number): void {
    this.#passes.lens(glass, seconds);
  }

  focus(effects: Focus): void {
    this.#fall.afterFocus(effects.depthOfField || effects.tiltShift, this.scene);
    this.#passes.focus(effects);
  }

  /** Rain or snow in the air (ADR 23): `sparse` for the lite tier's thin field, null for none.
   * Apart from `light`: what falls is the motion tier's to show. */
  fall(falling: Falling | null, sparse: boolean): void {
    this.#fall.show(falling, sparse);
  }

  /** Moves what falls to where it is after `seconds` of the weather loop. */
  drift(seconds: number): void {
    this.#fall.drift(seconds);
  }

  setSize(width: number, height: number): void {
    this.#size = [width, height];
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.#passes.setSize(width, height, this.pixelRatio);
    this.#fall.size(height * this.pixelRatio);
  }

  /** Draws the scene as it is now. */
  render(): void {
    this.#passes.render();
  }

  /** Counts what each frame draws from here on (ADR 21 "Measuring"); `clock` tells its time. */
  measure(clock?: () => number) {
    return this.#passes.measure(() => this.#sun.shadow.map, clock);
  }

  /** Counts no more, and draws as before `measure`. */
  // fallow-ignore-next-line unused-class-member -- the readout calls it through the perf store.
  unmeasure(): void {
    this.#passes.unmeasure();
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
    await this.compileAsync(this.#environment.sky);
    this.#environment.open();
  }

  /** A frame of a few pixels: every pass makes and first uses its programs. */
  warm(): void {
    const [width, height] = this.#size;

    this.setSize(4, 4);
    this.#passes.warm();
    this.setSize(width, height);
  }

  dispose(): void {
    this.#passes.dispose();
    this.#fall.dispose();
    this.#environment.dispose();
    this.renderer.dispose();
  }

  /** The look's passes and shadow map. */
  #apply(): void {
    this.#passes.follow(this.#look);
    shadowFor(this.renderer, this.#sun, this.#look);
    this.#shade();
    this.recast();
  }

  #shade(): void {
    shade(this.#sun, this.#look);
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
