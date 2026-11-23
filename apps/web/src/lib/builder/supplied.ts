// What the builder's consumer supplies around the plant (ADR 20, 25). The builder fetches none
// of it and saves none of it.
import type { Face } from "./pv.ts";
import { isFaces, unwrap, type Exported } from "./replies.ts";

/**
 * An upright body around the plant: a footprint on the ground under a level top. It shades as
 * the scene's obstacles do.
 */
export interface Neighbour {
  /** Its outline's corners, metres east and north of the scene's origin: north up, whatever the
   * scene's compass. */
  readonly footprint: readonly (readonly [number, number])[];
  /** Its top's height above the ground, in metres. */
  readonly height: number;
}

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

export interface Supplier {
  /** The neighbours' walls and tops, east, north, up; throws the crate's reason for one refused. */
  readonly neighbours: (neighbours: readonly Neighbour[]) => Face[];
}

/** The crate's answers through `call`. */
export function suppliedCalls(call: (name: Exported, input: string) => string): Supplier {
  return {
    neighbours: (neighbours) => unwrap(call("neighbours", JSON.stringify(neighbours)), isFaces),
  };
}
