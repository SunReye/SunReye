// What hangs on a block's wall or sits in it (ADR 20): equipment markers, and windows and doors
// as the scene stores them and as the pv crate fits them.
import type { Light, OpeningKind, Point } from "./pv.ts";

/** Why an opening cannot be as asked: it lies over another, or its wall has no room for it. */
export type Unfit = "overlap" | "room";

/** A block's wall as the pv crate lays it out: east, north, up. */
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
