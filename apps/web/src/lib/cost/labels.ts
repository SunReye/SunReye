// Localized names for the range presets.
//
// `$lib/cost/ranges.ts` bakes an English `label` into every CostRange so the
// model stays free of the message catalogue. Anything user-facing goes through
// here instead — the picker's trigger and the statistics section captions both
// did their own lookup before, and the captions quietly kept the English one.

import { COST_PRESETS, type CostRange } from "./ranges";
import { dayMonth } from "$lib/format/date";
import { baselineLabel, pricedWindow, windowDays } from "$lib/statistics/compare";
import type { CompareMode } from "@SunReye/contracts/statistics";
import * as m from "$lib/paraglide/messages";

const PRESET_LABELS: Record<string, () => string> = {
  "7d": m.range_last_7d,
};

/** Localized name of a preset id; `fallback` covers ids with no message. */
export const presetLabel = (id: string, fallback: string): string =>
  PRESET_LABELS[id]?.() ?? fallback;

/** The kept presets as the period navigator's popover takes them, localized. */
export const statisticsPresets = (): readonly { id: string; label: string }[] =>
  COST_PRESETS.map((p) => ({ id: p.id, label: presetLabel(p.id, p.label) }));

/** The picked window as dates — "Aug 1 – 31", or one date for a single day.
 *  `to` is exclusive, so the label reads the last covered instant. */
function rangeSpan(window: { from: Date; to: Date }): string {
  const first = dayMonth(window.from);
  const last = dayMonth(new Date(window.to.getTime() - 1));
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Section caption: the dates the section covers and what its deltas compare
 * against. The preset's name is already on the picker directly above, so the
 * caption spends its line on what the name does not say.
 *
 * Both halves read the PRICED window, not the picked one. A calendar period the
 * reader is standing in ends in the future so its chart axis is settled, and a
 * caption built from that edge would name days that have not happened and
 * compare against a baseline the server never used.
 */
export const rangeCaption = (
  range: CostRange,
  mode: CompareMode,
  now: Date = new Date(),
): string => {
  const window = pricedWindow(range, now);
  return m.statistics_caption_range({
    span: rangeSpan(window),
    baseline: baselineLabel(mode, windowDays(window.from, window.to)),
  });
};
