import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";

/**
 * Dashboard visibility preferences shape. Mirrors the server's `uiPrefsSchema`
 * (packages/db/src/ui-prefs.ts) — kept as a local type per the web convention
 * of not depending on the db package (see display.svelte.ts).
 */
export type UiPrefs = {
  /** Individual metric keys hidden from the dashboard. */
  hiddenKeys: string[];
  /** Whole metric groups hidden — hides every metric in them. */
  hiddenGroups: string[];
};

/** Nothing hidden — the default before the preference loads. */
const defaultUiPrefs: UiPrefs = { hiddenKeys: [], hiddenGroups: [] };

/**
 * Instance-wide dashboard visibility preferences on the client. Fetched once
 * per session and cached. The inverter store reads {@link isHidden} at its
 * `get metrics()` choke point, so the reactive `hiddenKeys`/`hiddenGroups` sets
 * make every consuming surface (dashboard, system, history, controls,
 * power-flow) re-filter the instant a preference is saved — no reload needed.
 */
class UiPrefsStore {
  config = $state<UiPrefs>(defaultUiPrefs);
  #loadPromise: Promise<void> | null = null;

  // Sets for O(1) membership from the hot `get metrics()` path; rebuilt only
  // when the config changes.
  #hiddenKeys = $derived(new Set(this.config.hiddenKeys));
  #hiddenGroups = $derived(new Set(this.config.hiddenGroups));

  /** True when a metric should be hidden from the dashboard (by group or key). */
  isHidden(key: string, group: string): boolean {
    return this.#hiddenGroups.has(group) || this.#hiddenKeys.has(key);
  }

  /**
   * Fetch the saved preference once. Concurrent callers (inverter store +
   * settings form) share the same in-flight request and all resolve with the
   * config set.
   */
  load(): Promise<void> {
    this.#loadPromise ??= api.api.settings.ui.get().then(({ data }) => {
      if (data) this.config = data as UiPrefs;
    });
    return this.#loadPromise;
  }

  /** Re-fetch from the server, bypassing the once-per-session cache. */
  async reload(): Promise<void> {
    const { data } = await api.api.settings.ui.get();
    if (data) this.config = data as UiPrefs;
  }

  /** Persist a new config; on success the reactive sets update in place. */
  async save(next: UiPrefs): Promise<boolean> {
    const { data, error } = await api.api.settings.ui.put(next);
    if (error) return false;
    this.config = payloadOrNull<UiPrefs>(data) ?? next;
    return true;
  }
}

export const uiPrefs = new UiPrefsStore();
