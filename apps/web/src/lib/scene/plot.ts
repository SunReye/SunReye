// The ground the studio stands a scene on (ADR 20 Look): a floor that fades into the page round
// the plot, and fog past it, which the weather's closes in (ADR 23).
import { Fog, type Mesh, Vector2 } from "three";
import { ground } from "./backdrop.ts";
import { mix } from "./colour.ts";
import type { Theme } from "./light.ts";
import { untone, type Triple } from "./tone.ts";
import { fogColour, type SceneWeather } from "./weather.ts";
import { weathered } from "./weathered.ts";

/** Where the fog starts and ends, as radii of the plot and metres past them: far off in clear
 * air, and round the plot in fog, which veils the house and never hides it. */
const CLEAR = { near: [4, 40], far: [16, 160] } as const;
const FOGGED = { near: [1, 0], far: [6, 30] } as const;

export class Plot {
  readonly #fade = { centre: { value: new Vector2() }, radius: { value: 12 } };

  readonly floor: Mesh = ground(this.#fade);

  /** How far the weather's fog has closed in, 0 to 1. */
  #mist = 0;

  /** Far ground and trees melt into its colour, the page's. */
  readonly fog = new Fog(0xffffff);

  constructor() {
    this.floor.name = "floor";
  }

  /** Fits the floor's fade and the fog to the plot: its centre east and south, and its radius in
   * metres. */
  fit(east: number, south: number, radius: number): void {
    this.#fade.centre.value.set(east, south);
    this.#fade.radius.value = radius;
    this.#reach();
  }

  /** The `weather` on the floor and in the fog, which lands on the `page` colour in clear air. */
  weather(weather: SceneWeather, page: Triple, { dark, exposure }: Theme): void {
    this.fog.color.setRGB(...untone(fogColour(page, dark, weather.fog), exposure));
    this.mist(weather.fog);
    weathered(this.floor, weather);
  }

  /** Closes the fog in `density` of the way, 0 to 1. */
  mist(density: number): void {
    this.#mist = density;
    this.#reach();
  }

  #reach(): void {
    const radius = this.#fade.radius.value;
    const at = ([radii, past]: readonly [number, number]): number => radius * radii + past;

    this.fog.near = mix(at(CLEAR.near), at(FOGGED.near), this.#mist);
    this.fog.far = mix(at(CLEAR.far), at(FOGGED.far), this.#mist);
  }
}
