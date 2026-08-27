/**
 * A draft overlay: metrics a reader is trying out on one full-screened history
 * card, that no server has ever seen.
 *
 * The point of the draft is that it costs nothing to make and nothing to throw
 * away — you full-screen the card for one metric, pull a second one in to see
 * whether the two are related, and either save it as a custom chart or drop it
 * by leaving full screen. So this holds only the metrics added ON TOP of the
 * card's own: the base is the card, it is always first, and it cannot be
 * removed.
 *
 * Base-first is not cosmetic. Series colour is assigned by position
 * ({@link overlayColor}), so keeping the base at index 0 means the line the
 * reader started from stays the same colour while others come and go.
 */

import { MAX_CHART_METRICS } from "./custom-chart";

/** The full overlay list for a card: its own metric, then whatever was added. */
export function draftMetrics(base: string, draft: readonly string[]): string[] {
  return [base, ...draft.filter((key) => key !== base)];
}

/** Is this metric currently drawn — either the base, or drafted on top? */
export function isDrafted(base: string, draft: readonly string[], key: string): boolean {
  return key === base || draft.includes(key);
}

/**
 * The draft after picking `key` in the metric list.
 *
 * Three refusals, each a decision rather than a guard: the base cannot be added
 * (it is already drawn) nor removed (it is the card), and the overlay cannot
 * grow past the limit a *saved* chart has — a draft that could would be a draft
 * the user cannot save, since it is saved through the ordinary editor.
 */
export function toggleDraft(base: string, draft: readonly string[], key: string): string[] {
  if (key === base) return [...draft];
  if (draft.includes(key)) return draft.filter((held) => held !== key);
  if (draftMetrics(base, draft).length >= MAX_CHART_METRICS) return [...draft];
  return [...draft, key];
}
