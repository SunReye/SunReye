// Localized names for the range presets.
//
// `$lib/cost/ranges.ts` bakes an English `label` into every CostRange so the
// model stays free of the message catalogue. Anything user-facing goes through
// here instead — the picker's trigger and the statistics section captions both
// did their own lookup before, and the captions quietly kept the English one.

import type { CostRange } from "./ranges";
import * as m from "$lib/paraglide/messages";

const PRESET_LABELS: Record<string, () => string> = {
  today: m.range_today,
  "7d": m.range_last_7d,
  month: m.range_this_month,
  lastMonth: m.range_last_month,
  year: m.range_this_year,
};

/** Localized name of a preset id; `fallback` covers ids with no message. */
export const presetLabel = (id: string, fallback: string): string =>
  PRESET_LABELS[id]?.() ?? fallback;

/** Localized name of a resolved range. A custom range keeps its own label,
 *  which is already formatted in the UI locale. */
export const rangeLabel = (range: CostRange): string => presetLabel(range.id, range.label);
