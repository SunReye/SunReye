// What a block carries besides its footprint and roof in the scene's schema (ADR 20 Blocks): its
// roof's overhang, the chimneys standing on its roof faces and the roof windows lying in them.

import type { Point } from "./pv.ts";

/** What lies on a block's roof face by its centre: a chimney or a roof window. */
export interface OnRoof {
  readonly block: number;
  readonly face: number;
  readonly across: number;
  readonly up: number;
}

/** A chimney's foot on its roof face as the pv crate lays it out: its corners from the lower
 * left, east, north, up, and the height of its level top. */
export interface Footing {
  readonly foot: readonly Point[];
  readonly top: number;
}
