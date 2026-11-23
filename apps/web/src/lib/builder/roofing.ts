// What a block carries besides its footprint and roof in the scene's schema (ADR 20 Blocks): its
// roof's overhang, the chimneys standing on its roof faces and the roof windows lying in them.

import type { Point } from "./pv.ts";

export interface Overhang {
  readonly eave: number;
  readonly verge: number;
}

/** In the scene's frame before the compass turns it, in metres (ADR 20). */
export interface FreeForm {
  /** Corners as x and z. */
  readonly footprint: readonly (readonly number[])[];
  /** Each face's corners as x, y and z, counter-clockwise seen from above. */
  readonly faces: readonly (readonly (readonly number[])[])[];
}

/** What lies on a block's roof face by its centre: a chimney or a roof window. */
export interface OnRoof {
  readonly block: number;
  readonly face: number;
  readonly across: number;
  readonly up: number;
}

/** An upright box on a block's roof face, placed in the face's outline like its module grid. */
export interface Chimney {
  readonly block: number;
  readonly face: number;
  /** Its centre: metres across the slope and up it from the face's lowest corner on the left. */
  readonly across: number;
  readonly up: number;
  /** Level: across the slope, and along the fall line seen from above. */
  readonly width: number;
  readonly depth: number;
  /** Over the roof where its upper side meets it. */
  readonly height: number;
}

/** A window lying flush in a block's roof face, placed in the face's outline like a chimney. */
export interface RoofWindow {
  readonly block: number;
  readonly face: number;
  /** Its centre: metres across the slope and up it from the face's lowest corner on the left. */
  readonly across: number;
  readonly up: number;
  /** Across the slope, and up it. */
  readonly width: number;
  readonly length: number;
}

/** A chimney's foot on its roof face as the pv crate lays it out: its corners from the lower
 * left, east, north, up, and the height of its level top. */
export interface Footing {
  readonly foot: readonly Point[];
  readonly top: number;
}
