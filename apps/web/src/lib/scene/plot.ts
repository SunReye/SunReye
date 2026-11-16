// The ground the studio stands a scene on (ADR 20 Look): a lawn that fades into the page round
// the plot, and fog past it.
import { Fog, type Mesh, Vector2 } from "three";
import { ground } from "./backdrop.ts";

export class Plot {
  readonly #fade = { centre: { value: new Vector2() }, radius: { value: 12 } };

  readonly lawn: Mesh = ground(this.#fade);

  /** Far ground and trees melt into its colour, the page's. */
  readonly fog = new Fog(0xffffff);

  /** Fits the lawn's fade and the fog to the plot: its centre east and south, and its radius in
   * metres. */
  fit(east: number, south: number, radius: number): void {
    this.#fade.centre.value.set(east, south);
    this.#fade.radius.value = radius;
    this.fog.near = radius * 4 + 40;
    this.fog.far = radius * 16 + 160;
  }
}
