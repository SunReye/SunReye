// The card's words: the figures, the baseline beside their changes, the tabs' labels.
import { m } from "../paraglide/messages.js";
import { rangeKey } from "../range/range.ts";
import { figuresOf, type Figure } from "./answer.ts";
import type { Range } from "../range/range.ts";
import type { Loaded } from "./stats.svelte.ts";
import type { Tab, StatsView } from "./view.ts";
import { against } from "./words.ts";

const TAB_LABELS: Readonly<Record<Tab, () => string>> = {
  time: m.stats_tab_time,
  years: m.stats_tab_years,
  pattern: m.stats_tab_pattern,
  forecast: m.stats_tab_forecast,
  tariff: m.stats_tab_tariff,
  payback: m.stats_tab_payback,
  strings: m.stats_tab_strings,
  battery: m.stats_tab_battery,
  data: m.stats_tab_data,
};

export interface CardText {
  readonly figures: Figure[];
  /** "zum Vormonat"; empty without a baseline. */
  readonly against: string;
  readonly verdictId: string;
  readonly tabsLabel: string;
  readonly tabs: (readonly [Tab, string])[];
}

export interface CardInput {
  readonly range: Range;
  readonly view: Readonly<StatsView>;
  readonly tabs: readonly Tab[];
}

export function cardText(s: CardInput, got: Readonly<Loaded> | undefined): CardText {
  const base = got !== undefined && got.base.sum.covered > 0;

  return {
    figures: figuresOf(got),
    against: base ? against(s.range, s.view.cmp) : "",
    verdictId: `${rangeKey(s.range)}|${s.view.metric}|${s.view.cmp}`,
    tabsLabel: m.stats_tabs(),
    tabs: s.tabs.map((t) => [t, TAB_LABELS[t]()] as const),
  };
}
