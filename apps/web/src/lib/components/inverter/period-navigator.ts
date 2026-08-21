/**
 * The period navigator's decisions, lifted out of its markup.
 *
 * The control is two rows — four grain tabs, then `‹ 📅 title ›` — and every
 * piece of arithmetic in it (stepping, the live predicate, the period title)
 * belongs to `$lib/time/period` and is proven there. What lives here is the
 * handful of choices that are the NAVIGATOR's rather than the calendar's: which
 * grains get a tab, what the header prints when the reader is not on a calendar
 * period at all, and the one class the four-option row cannot get wrong.
 */

import { periodTitle, type Grain, type Period, type PeriodLabelOptions } from "$lib/time/period";

/**
 * The tabs, finest first, so the row reads left to right as zooming out.
 *
 * There is deliberately no fifth "Live" tab. Standing on the current period IS
 * live — the day tab on today, the month tab in August — and the forward arrow
 * going dead is what tells the reader so. A Live tab would be a second control
 * for the state they are already in, and it would have to answer what "Live"
 * means at month granularity.
 */
// fallow-ignore-next-line unused-export -- the tab ORDER is the claim, and `period-navigator.test.ts` derives `grid-cols-${GRAIN_TABS.length}` from it rather than restating 4; `grainTabs` is the only in-module caller and hides the count
export const GRAIN_TABS: readonly Grain[] = ["day", "week", "month", "year"];

/**
 * A range the navigator is showing that is NOT a calendar period: one of the
 * kept presets (1h, 6h, 14d, 6mo…) or an arbitrary custom range. `label` is
 * already localized by the page — `$lib/cost/labels` owns the preset names and
 * a custom range's label is formatted dates.
 */
export interface RangeOverride {
  id: string;
  label: string;
}

/** The words the navigator needs and this module refuses to import. */
export interface GrainMessages {
  day: () => string;
  week: () => string;
  month: () => string;
  year: () => string;
  /** The day period holding `now` — "Today", "Heute". */
  today: () => string;
  /** A week, named by the date it starts on — "Week of Aug 17". */
  weekOf: (args: { date: string }) => string;
  /** The back arrow, per grain — "Previous month". See {@link stepLabels}. */
  prev: Record<Grain, () => string>;
  /** The forward arrow, per grain — "Next month". */
  next: Record<Grain, () => string>;
}

/**
 * The two arrows' accessible names, for the grain they step.
 *
 * PER GRAIN, and not one generic pair, because a name has to be unambiguous on
 * the page it is spoken on. /statistics has carried a compare-mode button
 * reading "Previous period" since before this control existed — it sits in that
 * page's toolbar now, a row above these arrows — so an arrow
 * labelled "Previous period" gave that route two buttons with one accessible
 * name, doing entirely different things — indistinguishable to a screen reader,
 * and ambiguous to every locator that addresses a control by its name.
 *
 * A parameterised "Previous {grain}" would have been one message instead of
 * eight, and would be wrong in four of the five catalogues: the adjective agrees
 * with the noun's gender in German, French, Spanish and Italian ("Vorheriger
 * Monat", but "Vorherige Woche"). So each pair is its own message.
 *
 * The names stay grain-shaped while an override is showing: the back arrow does
 * step the underlying period, and forward returns to live at that same grain.
 */
export function stepLabels(
  grain: Grain,
  messages: GrainMessages,
): { back: string; forward: string } {
  return { back: messages.prev[grain](), forward: messages.next[grain]() };
}

/** The four tabs with their localized labels, in {@link GRAIN_TABS} order. */
export function grainTabs(messages: GrainMessages): readonly { id: Grain; label: string }[] {
  return GRAIN_TABS.map((id) => ({ id, label: messages[id]() }));
}

/**
 * The class the tab row wears, and the phone-form decision it encodes.
 *
 * `SEGMENTED_MAX_OPTIONS` (3) governs `RangeSwitcher`, whose options are a
 * WRAPPING flex row: a fourth chip lands on a second line at 412px and reads as
 * a separate control, so past three that component offers a Select instead. This
 * row is four options by design and does not bend that token — it is not a
 * wrapping row at all. Four equal columns cannot wrap, and the labels are one
 * short word each in all five locales ("Settimana" is the longest, ~60px at
 * text-xs inside an 89px column at 390px), so the row fits as a row.
 *
 * The base column count is stated for the phone, not deferred to a breakpoint:
 * `sm:grid-cols-4` alone is one column below `sm` by accident rather than by
 * decision, which is the rule `lib/layout/mobile-density.test.ts` holds the
 * whole tree to.
 */
export const GRAIN_ROW = "grid grid-cols-4";

/**
 * Which tab is lit, or `null` for none.
 *
 * A preset or a custom range is not a calendar period, so no tab is its tab.
 * Lighting the grain of the period the reader last stood on would claim that a
 * six-hour window or a 17-day comparison is a month.
 */
export function activeGrain(period: Period, override: RangeOverride | null): Grain | null {
  return override === null ? period.grain : null;
}

/**
 * What the calendar button prints: the period's own name, or the override's
 * label while one is showing.
 *
 * Delegated to `periodTitle` rather than reimplemented, so "Today" and the
 * zone's own calendar year are decided in exactly one place.
 */
export function navigatorTitle(
  period: Period,
  override: RangeOverride | null,
  opts: PeriodLabelOptions,
  messages: GrainMessages,
): string {
  return override?.label ?? periodTitle(period, opts, messages);
}
