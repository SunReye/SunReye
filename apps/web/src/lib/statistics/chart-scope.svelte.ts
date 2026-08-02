/**
 * The per-section view scope, as reactive state. Every chart-bearing section
 * holds the same three things — the viewer's ephemeral scope pick, the spec it
 * resolves to, and its localized caption — so they hold them through here
 * rather than each rebuilding the trio.
 */

import { chartSpecFor, type ChartScope, type ChartSpec, type CostRange } from "$lib/cost/ranges";
import { chartCaption, defaultChartScope, type ScopedSection } from "./chart-scope";

export type SectionScope = {
  /** Bound by the section header's RangeSwitcher. */
  scope: ChartScope;
  /** Window + bucket the section's charts fetch and plot. */
  readonly spec: ChartSpec;
  /** What the charts are currently plotting, in words. */
  readonly caption: string;
};

/**
 * Scope state for one section, seeded from the saved preference and ephemeral
 * afterwards. `range` is a getter so the spec and caption track the picked
 * range without the section re-creating this.
 */
export function sectionScope(section: ScopedSection, range: () => CostRange): SectionScope {
  let scope = $state<ChartScope>(defaultChartScope(section));
  const spec = $derived(chartSpecFor(range(), scope));
  const caption = $derived(chartCaption(range(), scope));
  return {
    get scope() {
      return scope;
    },
    set scope(next: ChartScope) {
      scope = next;
    },
    get spec() {
      return spec;
    },
    get caption() {
      return caption;
    },
  };
}
