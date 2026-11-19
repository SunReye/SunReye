// What surrounds a studio's scene (ADR 20 Look): the sky model at the sun, prefiltered into the
// scene's environment, and the backdrop in the air's colour. Each is made on a change that would
// show, never per frame.
import {
  Color,
  PMREMGenerator,
  Scene,
  type Texture,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { toThree } from "../builder/scene.ts";
import { aim, backdrop, sky } from "./backdrop.ts";
import type { Daylight, Theme } from "./light.ts";
import { skyStep } from "./sky-step.ts";

export class Environment {
  /** The sky model alone: what the environment is made from, and compiled ahead. */
  readonly sky = new Scene();
  readonly #lit: Scene;
  readonly #pmrem: PMREMGenerator;
  readonly #model = sky(1000);
  #made: WebGLRenderTarget | undefined;
  /** What the environment was made for: it is made again only on change. */
  #key = "";
  /** The light waits for `open`: made at once, the environment would compile its programs
   * blocking. */
  #held: readonly [Daylight, Theme] | null | undefined = null;
  #backdrop: Texture | undefined;
  #backdropped = "";

  /** Lights `lit`, drawn by `renderer`. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with them.
  constructor(renderer: WebGLRenderer, lit: Scene) {
    this.#lit = lit;
    this.#pmrem = new PMREMGenerator(renderer);
    this.sky.add(this.#model);
  }

  /** The backdrop in the `air`'s colour, and from `open` on the sky for the time and the theme. */
  light(day: Daylight, look: Theme, air: readonly [number, number, number]): void {
    if (this.#held === undefined) this.#make(day, look);
    else this.#held = [day, look];

    const backdropped = JSON.stringify([air, look]);

    if (backdropped === this.#backdropped) return;

    this.#backdropped = backdropped;
    this.#backdrop?.dispose();
    this.#backdrop = backdrop(new Color(...air), look.exposure, look.dark);
    this.#lit.background = this.#backdrop;
  }

  /** Makes the environment held since, once the sky's programs are compiled: they are first
   * used on a map of a few pixels. */
  open(): void {
    this.#pmrem.fromScene(this.sky, 0, 0.1, 2000, { size: 16 }).dispose();

    const held = this.#held;

    this.#held = undefined;

    if (held !== null && held !== undefined) this.#make(...held);
  }

  dispose(): void {
    this.#made?.dispose();
    this.#backdrop?.dispose();
    this.#pmrem.dispose();
  }

  /**
   * The sky model at the sun, as the scene's environment. Made again only once the sun has moved
   * a step of its sky (sky-step.ts), the clouds have changed or the theme has: a minute moves
   * the sun by far less. Its strength follows the light at once.
   */
  #make(day: Daylight, { dark, environment }: Theme): void {
    const key = JSON.stringify([skyStep(day.sun), dark, Math.round(day.clouds.coverage * 20)]);

    this.#lit.environmentIntensity = day.environment * environment;

    if (key === this.#key) return;

    this.#key = key;
    aim(this.#model, new Vector3(...toThree(day.sun)), {
      dark,
      low: day.haze,
      clouds: day.clouds,
    });
    this.#made?.dispose();
    this.#made = this.#pmrem.fromScene(this.sky, 0, 0.1, 2000);
    this.#lit.environment = this.#made.texture;
  }
}
