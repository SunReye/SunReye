// What the statistics screen says about a range: the range inside a sentence, its baseline's
// name, and the verdict that answers the chosen question. Pure, in the SPA's locale.
import { m } from "../paraglide/messages.js";
import { fmt, isoWeek, shortDay, yearOf } from "../range/calendar.ts";
import { kwh, money, num } from "../range/format.ts";
import { isCurrent, type Calendar, type Kind, type Range } from "../range/range.ts";
import type { Sum } from "./flows.ts";
import type { Money } from "./stats.svelte.ts";
import type { Compare, Metric } from "./view.ts";

/** The relative change from `was`; null without something to compare with. */
export const change = (now: number, was: number | null | undefined): number | null =>
  was === null || was === undefined || was <= 0 ? null : now / was - 1;

/** A change as a signed percentage, or in percentage points. */
export function delta(c: number | null, points = false): string {
  if (c === null) return "–";

  const v = Math.round(c * 100);
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";

  return `${sign}${Math.abs(v)} ${points ? m.stats_points() : "%"}`;
}

const isThisYear = (cal: Calendar, day: number) => yearOf(day) === yearOf(cal.today);

const PHRASES: Readonly<Record<Kind, (cal: Calendar, r: Range) => string>> = {
  day: (cal, r) => {
    if (r.from === cal.today) return m.stats_when_today();

    if (r.from === cal.today - 1) return m.stats_when_yesterday();

    return m.stats_when_day({ date: shortDay(r.from, !isThisYear(cal, r.from)) });
  },
  week: (cal, r) =>
    isCurrent(cal, r) ? m.stats_when_this_week() : m.stats_when_week({ week: isoWeek(r.from) }),
  month: (cal, r) =>
    isCurrent(cal, r)
      ? m.stats_when_this_month()
      : m.stats_when_month({
          month: fmt(isThisYear(cal, r.from) ? "month" : "monthYear", r.from),
        }),
  year: (cal, r) => (isCurrent(cal, r) ? m.stats_when_this_year() : String(yearOf(r.from))),
  custom: () => m.stats_when_custom(),
};

/** The range at the start of a sentence: "Heute", "Im Oktober", "2025". */
const phrase = (cal: Calendar, r: Range): string => PHRASES[r.kind](cal, r);

type Base = "day" | "week" | "month" | "year" | "custom";

const baseOf = (r: Range, cmp: Compare): Base => (cmp === "year" ? "year" : r.kind);

/** The baseline's name on the toggle: "Vormonat". */
export function previousLabel(r: Range): string {
  return {
    day: m.stats_prev_day,
    week: m.stats_prev_week,
    month: m.stats_prev_month,
    year: m.stats_prev_year,
    custom: m.stats_prev_custom,
  }[r.kind]();
}

/** Beside a change: "zum Vormonat". */
export function against(r: Range, cmp: Compare): string {
  return {
    day: m.stats_against_day,
    week: m.stats_against_week,
    month: m.stats_against_month,
    year: m.stats_against_year,
    custom: m.stats_against_custom,
  }[baseOf(r, cmp)]();
}

/** Inside a sentence: "im Vormonat". */
function within(r: Range, cmp: Compare): string {
  return {
    day: m.stats_within_day,
    week: m.stats_within_week,
    month: m.stats_within_month,
    year: m.stats_within_year,
    custom: m.stats_within_custom,
  }[baseOf(r, cmp)]();
}

export interface Said {
  readonly metric: Metric;
  readonly cal: Calendar;
  readonly range: Range;
  readonly cmp?: Compare;
  readonly sum: Sum;
  readonly money?: Money | null;
  readonly base: { readonly sum: Sum; readonly money: Money | null } | null;
  /** The plant's strings: how many are weak, and the day learning began while it has too few. */
  readonly strings?: {
    readonly weak: number;
    readonly total: number;
    readonly learning: number | null;
  };
}

function versus(s: Said, now: number, was: number | undefined): string {
  const c = s.base && s.base.sum.covered > 0 ? change(now, was) : null;

  if (c === null) return "";

  const v = Math.round(c * 100);
  const w = within(s.range, s.cmp ?? "prev");

  if (v === 0) return m.stats_versus_same({ within: w });

  return m.stats_versus({
    delta: Math.abs(v),
    more: v > 0 ? m.stats_more() : m.stats_less(),
    within: w,
  });
}

function plantVerdict(s: Said): string {
  const strings = s.strings ?? { weak: 0, total: 0, learning: null };

  if (strings.learning !== null)
    return m.stats_verdict_learning({ date: shortDay(strings.learning, true) });

  if (strings.weak > 0) return m.stats_verdict_weak({ count: strings.weak, total: strings.total });

  return m.stats_verdict_fine();
}

/** The sentence that answers the chosen question for the range. */
export function verdict(s: Said): string {
  if (s.metric === "plant") return plantVerdict(s);

  if (s.sum.covered <= 0) return m.stats_verdict_none();

  const when = phrase(s.cal, s.range);

  if (s.metric === "autarky")
    return m.stats_verdict_autarky({
      when,
      share: s.sum.autarky === null ? "–" : `${num(s.sum.autarky)} %`,
      bought: kwh(s.sum.purchase),
    });

  if (s.metric === "money") {
    if (!s.money) return m.stats_verdict_no_money({ when });

    return m.stats_verdict_money({
      when,
      money: money(s.money.saved),
      versus: versus(s, s.money.saved, s.base?.money?.saved),
    });
  }

  return m.stats_verdict_energy({
    when,
    energy: kwh(s.sum.production),
    versus: versus(s, s.sum.production, s.base?.sum.production),
  });
}
