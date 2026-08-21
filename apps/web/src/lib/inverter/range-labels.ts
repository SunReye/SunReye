// Localized names for the /history range presets.
//
// `$lib/inverter/ranges.ts` bakes an English `label` into every preset so the
// model stays free of the message catalogue — the same split `$lib/cost/labels`
// makes for the statistics page. Anything user-facing goes through here: the
// period navigator's popover, and the title it prints while a preset or a zoom
// window is showing instead of a calendar period.

import * as m from "$lib/paraglide/messages";
import { KEPT_PRESETS } from "./ranges";

const PRESET_LABELS: Record<string, () => string> = {
  "1h": m.range_1h,
  "6h": m.range_6h,
  "14d": m.range_14d,
  "6mo": m.range_6mo,
};

/**
 * Localized name of a preset id. `fallback` covers the ids that have no message
 * because their label is already formatted text: a zoomed span, a custom range.
 */
export const historyPresetLabel = (id: string, fallback: string): string =>
  PRESET_LABELS[id]?.() ?? fallback;

/** The kept presets as the navigator's popover takes them, localized. */
export const historyPresets = (): readonly { id: string; label: string }[] =>
  KEPT_PRESETS.map((p) => ({ id: p.id, label: historyPresetLabel(p.id, p.label) }));
