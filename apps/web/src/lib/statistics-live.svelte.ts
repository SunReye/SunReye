import type { StatisticsTodayMessage } from "@SunReye/contracts/statistics";
import type { CostRange } from "$lib/cost/ranges";
import { StatisticsLiveFeed } from "$lib/statistics/live-feed";
import { bus } from "$lib/ws/bus.svelte";

/**
 * Reactive shell over {@link StatisticsLiveFeed} — the Statistics page's view of
 * the `statistics` topic. The server republishes today's cost breakdown and
 * energy split every 15 s (only while someone is subscribed) and a bare `prices`
 * signal after a spot-price sync.
 *
 * The transport is not this store's business: {@link bus} owns the one socket
 * and the topic refcount, and the feed owns the leases and the throttle — both
 * plain TS, both tested. What is left here is the `$state` the page reads.
 */
class StatisticsLiveStore {
  /** Latest pushed snapshot while a `today` lease is held; null otherwise. */
  #snapshot = $state<StatisticsTodayMessage | null>(null);
  /**
   * Bumped when the range-wide reads (comparison + the sections' series) should
   * refetch. Read it inside a fetch `$effect` to opt that fetch in.
   */
  revision = $state(0);
  /** Bumped when a spot-price sync stored fresh slots. Everything price-derived
   *  (the price panel, the spot analytics reads) is stale at that point. */
  priceRevision = $state(0);

  #feed = new StatisticsLiveFeed({
    subscribe: (on) => bus.subscribe("statistics", on),
    onToday: (snapshot) => {
      this.#snapshot = snapshot;
    },
    onRevision: () => {
      this.revision += 1;
    },
    onPriceRevision: () => {
      this.priceRevision += 1;
    },
  });

  /**
   * The snapshot, but only while the connection is up: an outage must not leave
   * frozen figures patched over the tiles. The page falls back to the fetched
   * window until the reconnect's backfill lands.
   */
  get today(): StatisticsTodayMessage | null {
    return bus.connected ? this.#snapshot : null;
  }

  /**
   * Lease the feed for a now-inclusive range from a component `$effect`;
   * returns the cleanup that releases it. Call it only for a range that
   * `includesNow` — a past-only range must hold no lease.
   */
  lease(range: CostRange): () => void {
    return this.#feed.lease(range);
  }
}

export const statisticsLive = new StatisticsLiveStore();
