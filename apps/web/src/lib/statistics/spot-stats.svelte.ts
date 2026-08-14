/**
 * Spot-price analytics for the picked window, plus the capability answer the
 * page needs *before* it decides whether the price section exists at all.
 *
 * One store rather than a fetch inside the section, because the two consumers
 * are at different levels: the section list must know whether the feed is
 * configured (a null payload hides the section entirely — and with it its
 * customize toggle), while the section body renders the payload itself. Both
 * read this, so the window is fetched once either way.
 */

import type { SpotStats } from "server/src/spot-stats";
import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";

class SpotStatsStore {
  /** The current window's analytics; null when the feed is unconfigured. */
  stats = $state<SpotStats | null>(null);
  /** False until the first response lands — the section stays away until then
   *  rather than appearing and vanishing. */
  loaded = $state(false);
  /** Window of the newest request, so a slower earlier one can't clobber it. */
  #key = "";

  /** Whether this system has a spot price feed at all. */
  get available(): boolean {
    return this.loaded && this.stats !== null;
  }

  /**
   * Fetch `[from, to)` unless that window is already the one in flight.
   * `revision` counts spot-price syncs pushed by the live stream: a new sync
   * changes the answer for an unchanged window, so it is part of the key.
   */
  load(from: Date, to: Date, revision = 0): void {
    const query = { from: from.toISOString(), to: to.toISOString() };
    const key = `${query.from}|${query.to}|${revision}`;
    if (key === this.#key) return;
    this.#key = key;
    void api.api.statistics.prices.get({ query }).then(({ data }) => {
      if (this.#key !== key) return;
      this.stats = payloadOrNull<SpotStats>(data);
      this.loaded = true;
    });
  }
}

export const spotStats = new SpotStatsStore();
