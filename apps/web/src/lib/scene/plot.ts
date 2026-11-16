// The ground the studio stands a scene on (ADR 20 Look): a lawn that fades into the page round
// the plot, and fog past it; imported surroundings take the lawn's place and push the fog out.
import { Fog, type Mesh, Vector2 } from "three";
import { ground } from "./backdrop.ts";

export class Plot {
  readonly #fade = { centre: { value: new Vector2() }, radius: { value: 12 } };

  readonly lawn: Mesh = ground(this.#fade);

  /** Far ground and trees melt into its colour, the page's. */
  readonly fog = new Fog(0xffffff);

  #radius = 10;

  /** Metres imported surroundings reach from the plot; 0 without any. */
  #reach = 0;

  /** Fits the lawn's fade to the plot: its centre east and south, and its radius in metres. */
  fit(east: number, south: number, radius: number): void {
    this.#radius = radius;
    this.#fade.centre.value.set(east, south);
    this.#fade.radius.value = radius;
    this.surround(this.#reach);
  }

  /** Imported surroundings reach `metres` from the plot, 0 for none: their terrain lies in the
   * lawn's place, and the fog starts past them, so they melt into the page at their own radius. */
  surround(metres: number): void {
    const radius = Math.max(this.#radius, metres);

    this.#reach = metres;
    this.lawn.visible = metres === 0;
    this.fog.near = radius * 4 + 40;
    this.fog.far = radius * 16 + 160;
  }
}
