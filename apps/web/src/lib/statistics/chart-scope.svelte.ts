/**
 * The per-section view scope, as reactive state. Every chart-bearing section
 * holds the same three things — the viewer's ephemeral scope pick, the spec it
 * resolves to, and its localized caption — so they hold them through here
 * rather than each rebuilding the trio.
 */

import { chartSpecFor, type ChartScope, type ChartSpec, type CostRange } from "$lib/cost/ranges";
import { activeSpec, zoomAnchor, type SpecZoom } from "$lib/charts/zoom-range";
import { statisticsPrefs } from "$lib/statistics-prefs.svelte";
import { getCustomizeSession } from "./customize.svelte";
import { chartCaption, type ScopedSection } from "./chart-scope";

export type SectionScope = {
  /** Bound by the section header's RangeSwitcher. */
  scope: ChartScope;
  /** Window + bucket the section's charts fetch and plot. */
  readonly spec: ChartSpec;
  /** What the charts are currently plotting, in words. */
  readonly caption: string;
  /** Is a zoom currently narrowing the section, rather than its own scope? */
  readonly zoomed: boolean;
  /** Narrow the section to a drag-selected window, or `null` to drop it. */
  zoomTo(spec: ChartSpec | null): void;
};

/**
 * Scope state for one section: ephemeral for every viewer, defaulting to the
 * saved preference until they pick. An admin's current pick is what the
 * customize draft stores when they save the layout — the same arrangement the
 * compare mode and the YoY metric use, so the switchers stay live controls
 * rather than becoming a second set of customize-only widgets.
 *
 * `range` is a getter so the spec and caption track the picked range without
 * the section re-creating this.
 */
export function sectionScope(section: ScopedSection, range: () => CostRange): SectionScope {
  const customize = getCustomizeSession();
  let picked = $state<ChartScope | null>(null);
  const scope = $derived(picked ?? statisticsPrefs.optionFor(section).chartScope);
  const base = $derived(chartSpecFor(range(), scope));

  // A zoom is the same kind of thing as `picked`: ephemeral, per viewer, and
  // never written to `statisticsPrefs`. Anchoring and expiry live in
  // `$lib/charts/zoom-range` where they are tested; all that is held here is the
  // state itself.
  let zoom = $state<SpecZoom | null>(null);
  const spec = $derived(activeSpec(base, zoom));
  const caption = $derived(spec === base ? chartCaption(range(), scope) : spec.caption);
  return {
    get zoomed() {
      return spec !== base;
    },
    zoomTo(next: ChartSpec | null) {
      zoom = zoomAnchor(base, next);
    },
    get scope() {
      return scope;
    },
    set scope(next: ChartScope) {
      picked = next;
      // Switching scope is its own answer to "which window?"; keeping a zoom
      // across it would land the viewer on a window neither control names.
      zoom = null;
      if (customize.active) customize.draft[section].chartScope = next;
    },
    get spec() {
      return spec;
    },
    get caption() {
      return caption;
    },
  };
}
