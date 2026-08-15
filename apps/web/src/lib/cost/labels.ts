// Localized names for the range presets.
//
// `$lib/cost/ranges.ts` bakes an English `label` into every CostRange so the
// model stays free of the message catalogue. Anything user-facing goes through
// here instead — the picker's trigger and the statistics section captions both
// did their own lookup before, and the captions quietly kept the English one.

import type { CostRange } from "./ranges";
import { dayMonth } from "$lib/format/date";
import { baselineLabel, windowDays } from "$lib/statistics/compare";
import type { CompareMode } from "@SunReye/contracts/statistics";
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

/** The picked window as dates — "Aug 1 – 31", or one date for a single day.
 *  `to` is exclusive, so the label reads the last covered instant. */
function rangeSpan(range: CostRange): string {
  const first = dayMonth(range.from);
  const last = dayMonth(new Date(range.to.getTime() - 1));
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Section caption: the dates the section covers and what its deltas compare
 * against. The preset's name is already on the picker directly above, so the
 * caption spends its line on what the name does not say.
 */
export const rangeCaption = (range: CostRange, mode: CompareMode): string =>
  m.statistics_caption_range({
    span: rangeSpan(range),
    baseline: baselineLabel(mode, windowDays(range.from, range.to)),
  });
