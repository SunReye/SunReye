import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";

/**
 * Statistics-page layout preferences. Mirrors the server's
 * `statisticsPrefsSchema` (packages/db/src/statistics-prefs.ts) — kept as a
 * local type per the web convention of not depending on the db package (see
 * ui-prefs.svelte.ts / display.svelte.ts).
 */
export type StatisticsPrefs = {
  /** Section ids hidden from the page — hidden sections are never mounted. */
  hiddenSections: string[];
  /** Individual tiles hidden, namespaced `section.tileId`. */
  hiddenTiles: string[];
  /** Sections that start collapsed; viewers can still expand them. */
  collapsedSections: string[];
  cost: { chartScope: "detail" | "context" };
  energy: {
    bucket: "day" | "month";
    chartScope: "detail" | "context";
    heatmapField: "load" | "import" | "export" | "production";
  };
  prices: { windowDays: number };
  records: { compareMode: "previous" | "yearAgo"; yoyMetric: "net" | "production" };
};

/** Sections that carry display options of their own. */
type OptionSection = "cost" | "energy" | "prices" | "records";

/** Everything visible, default options — what renders before the fetch lands. */
export const defaultStatisticsPrefs: StatisticsPrefs = {
  hiddenSections: [],
  hiddenTiles: [],
  collapsedSections: [],
  cost: { chartScope: "detail" },
  energy: { bucket: "day", chartScope: "detail", heatmapField: "load" },
  prices: { windowDays: 90 },
  records: { compareMode: "previous", yoyMetric: "net" },
};

/**
 * Instance-wide statistics-page preferences on the client: which sections and
 * tiles the curated layout shows, and the default per-section options. Fetched
 * once per session and cached; writes are admin-only server-side. The reactive
 * hidden-sets make every consuming surface re-filter the instant a preference
 * is saved — no reload needed.
 */
class StatisticsPrefsStore {
  config = $state<StatisticsPrefs>(defaultStatisticsPrefs);
  #loadPromise: Promise<void> | null = null;

  // Sets for O(1) membership from the render path; rebuilt only when the
  // config changes.
  #hiddenSections = $derived(new Set(this.config.hiddenSections));
  #hiddenTiles = $derived(new Set(this.config.hiddenTiles));
  #collapsedSections = $derived(new Set(this.config.collapsedSections));

  /** True when a whole section is hidden from the curated layout. */
  isSectionHidden(id: string): boolean {
    return this.#hiddenSections.has(id);
  }

  /** True when one tile (namespaced `section.tileId`) is hidden. */
  isTileHidden(id: string): boolean {
    return this.#hiddenTiles.has(id);
  }

  /** True when a section renders collapsed until the viewer expands it. */
  isSectionCollapsed(id: string): boolean {
    return this.#collapsedSections.has(id);
  }

  /** The saved display options of one section, e.g. the default compare mode. */
  optionFor<K extends OptionSection>(section: K): StatisticsPrefs[K] {
    return this.config[section];
  }

  /**
   * Fetch the saved preference once. Concurrent callers (page + sections)
   * share the same in-flight request and all resolve with the config set.
   */
  load(): Promise<void> {
    this.#loadPromise ??= api.api.settings.statistics.get().then(({ data }) => {
      if (data) this.config = data as StatisticsPrefs;
    });
    return this.#loadPromise;
  }

  /** Persist a new config; on success the reactive sets update in place. */
  async save(next: StatisticsPrefs): Promise<boolean> {
    const { data, error } = await api.api.settings.statistics.put(next);
    if (error) return false;
    this.config = payloadOrNull<StatisticsPrefs>(data) ?? next;
    return true;
  }
}

export const statisticsPrefs = new StatisticsPrefsStore();
