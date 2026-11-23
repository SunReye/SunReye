// What the builder's consumer supplies around the plant (ADR 20, 25). The builder fetches none
// of it and saves none of it.
import type { Face } from "@sunreye/pv-wasm";

/** Metres east and north of the scene's origin to the edges of what an image shows. */
export interface Extent {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** An aerial image, north up, and the ground it shows. Decoded by the consumer: the builder never
 * loads one. */
export interface Aerial {
  readonly image: TexImageSource;
  readonly extent: Extent;
}

/** What the scene draws of what the consumer supplies: the image, and the neighbours as the pv
 * crate's faces. */
export interface Around {
  readonly aerial?: Aerial | undefined;
  readonly neighbours: readonly Face[];
}
