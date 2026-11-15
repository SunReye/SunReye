// The swatches a block's roof and walls offer (ADR 20): common finishes, as `#rrggbb`.
import { m } from "../paraglide/messages.js";

/** A finish's colour and its name. */
export type Swatch = readonly [colour: string, name: () => string];

export const ROOF_COLOURS: readonly Swatch[] = [
  ["#9c4a32", m.colour_tile_red],
  ["#3b3e42", m.colour_anthracite],
  ["#1f2022", m.colour_black],
  ["#5b3a29", m.colour_brown],
];

export const WALL_COLOURS: readonly Swatch[] = [
  ["#f4f2ec", m.colour_white],
  ["#e9dcc0", m.colour_cream],
  ["#a7a8a5", m.colour_grey],
];

/** How the generated finishes look untinted (scene/pixels.ts): tiles, and plaster. */
export const OWN_ROOF = "#2b2b2c";
export const OWN_WALL = "#c3bcb0";
