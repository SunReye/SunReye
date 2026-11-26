// Explore's mode names (ADR 22).
import { m } from "../paraglide/messages.js";

const MODE_LABELS = {
  series: m.explore_series,
  overlay: m.explore_overlay,
  fold: m.explore_fold,
} as const;

/** A mode's name on the switch and on its pane. */
export const modeLabel = (mode: keyof typeof MODE_LABELS): string => MODE_LABELS[mode]();
