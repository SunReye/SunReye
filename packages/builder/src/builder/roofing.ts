// What lies on a block's roof face in the scene's schema (ADR 20 Blocks): the chimneys standing on
// it and the roof windows lying in it.

/** What lies on a block's roof face by its centre: a chimney or a roof window. */
export interface OnRoof {
  readonly block: number;
  readonly face: number;
  readonly across: number;
  readonly up: number;
}
