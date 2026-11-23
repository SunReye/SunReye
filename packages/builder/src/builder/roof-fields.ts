// The size rows of what lies on a roof face (ADR 20): a chimney's and a roof window's.
import { m } from "../paraglide/messages.js";
import { metres } from "./fields.ts";

/** A chimney's level width and depth, and its height over the roof. */
export const chimneySizes = () =>
  [
    ["width", metres(m.field_width(), 0.2, 3)],
    ["depth", metres(m.field_depth(), 0.2, 3)],
    ["height", metres(m.field_height(), 0.1, 5)],
  ] as const;

/** A roof window's width across the slope and its length up it. */
export const windowSizes = () =>
  [
    ["width", metres(m.field_width(), 0.3, 3)],
    ["length", metres(m.field_length(), 0.3, 3)],
  ] as const;
