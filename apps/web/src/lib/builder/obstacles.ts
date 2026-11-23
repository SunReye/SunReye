// What stands around the blocks in the scene's schema (ADR 20): obstacles, which shade, and
// ground surfaces and fences, which are only drawn.
import type { FenceFinish, GroundFinish, Point } from "./pv.ts";

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
