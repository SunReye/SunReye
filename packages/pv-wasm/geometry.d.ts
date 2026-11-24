// What the `pv` crate draws and shades of a scene (ADR 20): east, north, up, in metres.

import type { FenceFinish, GroundFinish, Light, OpeningKind } from "@sunreye/scene";

/** Metres: east, north, up. */
export type Point = readonly [number, number, number];

export interface Face {
  readonly surface: "wall" | "roof" | "obstacle" | "hedge" | "chimney";
  /** A flat polygon: convex, but for a free-form roof face or its wall. */
  readonly corners: readonly Point[];
  /** Its block's wall or roof colour, `#rrggbb`. */
  readonly colour?: string;
  /** The position in the scene's obstacles of the box or hedge it is a side of. */
  readonly obstacle?: number;
}

export type Solid = (
  | { readonly kind: "sphere"; readonly centre: Point; readonly radius: number }
  | {
      /** Upright; a cone narrows from `radius` at its base to its apex `height` above. */
      readonly kind: "cylinder" | "cone";
      readonly base: Point;
      readonly radius: number;
      readonly height: number;
    }
) & {
  /** The position in the scene's obstacles of the pole or tree it is part of; none for a
   * carport's post. */
  readonly obstacle?: number;
};

/** Where a marker is drawn, and its label's anchor straight above it, clear of its block. */
export interface Mount {
  readonly at: Point;
  readonly above: Point;
  /** A metre out of its wall, level: the way it faces. */
  readonly out: Point;
}

/** A ground surface as the crate places it: its corners on the ground. */
export interface Ground {
  readonly finish: GroundFinish;
  readonly corners: readonly Point[];
}

/** A fence as the crate places it: its points on the ground. */
export interface Fencing {
  readonly finish: FenceFinish;
  readonly height: number;
  readonly points: readonly Point[];
}

/** Why an opening cannot be as asked: it lies over another, or its wall has no room for it. */
export type Unfit = "overlap" | "room";

/** A block's wall as the crate lays it out: east, north, up. */
export interface WallFrame {
  /** Its left end on the ground, seen from outside. */
  readonly left: Point;
  /** A metre along it to the right, and its outward normal, both level. */
  readonly right: Point;
  readonly out: Point;
}

/** An opening on its wall. */
export interface Fitted {
  readonly kind: OpeningKind;
  /** Seen from outside: low left, low right, high right, high left. */
  readonly corners: readonly [Point, Point, Point, Point];
  /** The wall's outward normal, level. */
  readonly out: Point;
  /** Whether it glows at night; by the rule without one. */
  readonly light?: Light;
}

/** What the crate draws and shades. */
export interface Geometry {
  readonly faces: readonly Face[];
  readonly solids: readonly Solid[];
  /** By the scene's equipment; null while a marker lies off its wall. */
  readonly mounts?: readonly Mount[] | null;
  /** By car place: its centre on the ground, its nose's direction and its label; null while one
   * is refused. */
  readonly stands?:
    | readonly { readonly at: Point; readonly forward: Point; readonly above: Point }[]
    | null;
  /** By ground surface and by fence, placed on the ground; null while one is refused. */
  readonly ground?: readonly Ground[] | null;
  readonly fences?: readonly Fencing[] | null;
  /** By opening, fitted on its wall; null while one is refused. */
  readonly openings?: readonly Fitted[] | null;
  /** By roof window, its pane's corners from the lower left; null while one is refused. */
  readonly roofWindows?: readonly (readonly Point[])[] | null;
  /** By existing PV, its field's corners from the lower left; null while one is refused. */
  readonly existingPv?: readonly (readonly Point[])[] | null;
}
