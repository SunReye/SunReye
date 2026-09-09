/**
 * The selected source — the reactive shell over `./source.ts`.
 *
 * One choice for the whole app: every history, statistics and live read goes
 * through `source.current`, so switching a device re-scopes the dashboard, the
 * statistics page and the sparklines together. Persisted per browser.
 */

import { browser } from "$app/environment";
import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";
import {
  PLANT,
  STORAGE_KEY,
  type SourceId,
  type SourcesResponse,
  acceptsMetricsFrame,
  offersChoice,
  resolveSaved,
  shownUnder,
  sourceQuery,
} from "./source";

class SourceStore {
  current = $state<SourceId>(PLANT);
  sources = $state<SourcesResponse | null>(null);
  #loadPromise: Promise<void> | null = null;
  /** Listeners for a change of source — the live buffers re-seed on it. */
  #onSelect = new Set<() => void>();

  /** Fetch the source list once; concurrent callers share the request. */
  load(): Promise<void> {
    this.#loadPromise ??= api.api.sources.get().then(({ data }) => {
      this.sources = payloadOrNull<SourcesResponse>(data);
      this.current = resolveSaved(this.#saved(), this.sources);
    });
    return this.#loadPromise;
  }

  /** Re-read the list — after a device was added or retired in settings. */
  async reload(): Promise<void> {
    this.#loadPromise = null;
    await this.load();
  }

  select(id: SourceId): void {
    if (id === this.current) return;
    this.current = id;
    try {
      if (browser) localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage refused (private mode, quota): the choice still holds for this page.
    }
    for (const listener of this.#onSelect) listener();
  }

  /** Called when the source changes; the disposer detaches. */
  onSelect(listener: () => void): () => void {
    this.#onSelect.add(listener);
    return () => this.#onSelect.delete(listener);
  }

  get isPlant(): boolean {
    return this.current === PLANT;
  }

  /** Whether the switcher has anything to switch. */
  get offersChoice(): boolean {
    return offersChoice(this.sources);
  }

  /** The query fragment a series read appends. */
  get query(): { source: SourceId } {
    return sourceQuery(this.current);
  }

  /** Whether a metric is shown under the current source. */
  shows(metric: { role?: string | undefined }): boolean {
    return shownUnder(this.current, this.sources, metric);
  }

  /** Whether a live `metrics` frame belongs to the current source. */
  acceptsFrame(inverterId: string | undefined): boolean {
    return acceptsMetricsFrame(this.current, inverterId, this.sources);
  }

  #saved(): string | null {
    try {
      return browser ? localStorage.getItem(STORAGE_KEY) : null;
    } catch {
      return null;
    }
  }
}

export const source = new SourceStore();
