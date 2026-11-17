// The ground the studio stands a scene on (ADR 20 Look): a floor that fades into the page round
// the plot, and fog past it, which the weather's closes in by its metres of visibility (ADR 23).
import { Fog, type Mesh, Vector2 } from "three";
import { ground } from "./backdrop.ts";
import { untone, type Triple } from "./tone.ts";
import { fogMetres, type SceneWeather } from "./weather.ts";
import { weathered } from "./weathered.ts";

/** Where the fog starts and ends in clear air, as radii of the plot and metres past them: far
 * off, so only the far ground melts into the page. */
const CLEAR = { near: [4, 40], far: [16, 160] } as const;

/** The nearest the weather's fog ends, as radii of the plot and metres past them: beyond the
 * plot's far side, 3.5 radii from the camera that frames it, so fog veils the house and never
 * hides it. */
const VEILED = [4.5, 5] as const;

/** The share of the visibility at which linear fog is whole. Air takes a thing's contrast by
 * the distance's exponent, down to a fiftieth at the visibility (Koschmieder): a line from the
 * camera with that slope is whole at the visibility over ln 50, about a quarter of it. */
const WHOLE = 1 / Math.log(50);

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

  /** The `weather` on the floor and in the fog, which lands on `air`, the backdrop's colour. */
  weather(weather: SceneWeather, air: Triple, exposure: number): void {
    this.fog.color.setRGB(...untone(air, exposure));
    this.mist(weather.fog);
    weathered(this.floor, weather);
  }

  /** Closes the fog in `density` of the way, 0 to 1. */
  mist(density: number): void {
    this.#mist = density;
    this.#reach();
  }

  /** In metres from the camera, as the air is: the weather's fog ends at about a quarter of its
   * visibility and starts next to the camera, so it deepens across the plot. Thinner air starts
   * farther off, by the square of how far it ends, up to clear air's own distances. */
  #reach(): void {
    const radius = this.#fade.radius.value;
    const at = ([radii, past]: readonly [number, number]): number => radius * radii + past;
    const clear = at(CLEAR.far);
    const far = Math.min(clear, Math.max(fogMetres(this.#mist) * WHOLE, at(VEILED)));

    this.fog.far = far;
    this.fog.near = at(CLEAR.near) * (far / clear) ** 2;
  }
}
