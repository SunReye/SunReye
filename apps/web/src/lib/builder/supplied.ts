// What the builder's consumer supplies around the plant (ADR 20, 25). The builder fetches none
// of it and saves none of it.

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
