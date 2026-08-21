// Everything the Statistics live feed does with a frame, minus the runes: which
// leases are open, what each of them wants a push to mean, and the throttle on
// the wider windows. Plain TS because it is the part that can be wrong, and
// runes do not run under `bun test` (see `apps/web/TESTING.md`).

import type { StatisticsLiveMessage, StatisticsTodayMessage } from "@SunReye/contracts/statistics";
import type { CostRange } from "$lib/cost/ranges";
import { liveModeFor, shouldRevalidate, type LiveMode } from "./live";

export interface StatisticsFeedHooks {
  /** Take the topic lease — `bus.subscribe("statistics", on)`, or a fake in tests. */
  subscribe(on: (data: StatisticsLiveMessage) => void): () => void;
  /** A fresh `today` snapshot, or null when there is no longer one to show. */
  onToday(snapshot: StatisticsTodayMessage | null): void;
  /** The range-wide fetches are stale. */
  onRevision(): void;
  /** Everything price-derived is stale. */
  onPriceRevision(): void;
  /** Throttle clock, injected so the minute floor is testable. Defaults to `Date.now`. */
  now?(): number;
}

/** One open lease. An object, so two leases of the same range stay distinct. */
interface Lease {
  mode: LiveMode;
}

export class StatisticsLiveFeed {
  #hooks: StatisticsFeedHooks;
  #leases = new Set<Lease>();
  /** The topic disposer while at least one lease is open; null otherwise. */
  #release: (() => void) | null = null;
  /** Wall clock of the last {@link StatisticsFeedHooks.onRevision} — the throttle's memory. */
  #lastRevalidateAt: number | null = null;

  constructor(hooks: StatisticsFeedHooks) {
    this.#hooks = hooks;
  }

  /**
   * Lease the feed for a now-inclusive range from a component `$effect`;
   * returns the cleanup that releases it. Call it only for a range that
   * `includesNow` — a past-only range must hold no lease, which leaves the
   * server with zero subscribers and skips its interval job entirely.
   *
   * Leases are kept individually rather than collapsed into one current mode:
   * two pages' worth of ranges open at once (a `today` panel and a wider
   * section) each get what their window needs, and releasing one cannot leave
   * the other reading the departed range's mode.
   */
  // fallow-ignore-next-line unused-class-member -- called as `this.#feed.lease()` from the rune shell; calls through a private-field receiver aren't traced
  lease(range: CostRange): () => void {
    // Through the injected clock, not `Date.now()`: the mode now depends on
    // WHICH day the range is (`liveModeFor`), so a feed under a fake clock has
    // to read the same clock the throttle does or it decides against the host's.
    const lease: Lease = { mode: liveModeFor(range, new Date(this.#now())) };
    // The caller has just fetched this window, so the throttle starts closed
    // and the first invalidation lands a minute in, not on the backfill.
    if (lease.mode === "window") this.#lastRevalidateAt = this.#now();
    this.#leases.add(lease);
    this.#release ??= this.#hooks.subscribe((message) => this.#apply(message));

    let released = false;
    return () => {
      // A Svelte cleanup can run twice (teardown after an explicit release);
      // the second must not give back a lease someone else has since taken.
      if (released) return;
      released = true;
      this.#leases.delete(lease);
      if (this.#leases.size > 0) return;
      this.#release?.();
      this.#release = null;
      // Nobody is watching any more: a snapshot left patched over the tiles
      // would freeze at whatever the last push said.
      this.#hooks.onToday(null);
    };
  }

  #now(): number {
    return this.#hooks.now?.() ?? Date.now();
  }

  #wants(mode: LiveMode): boolean {
    for (const lease of this.#leases) if (lease.mode === mode) return true;
    return false;
  }

  #apply(message: StatisticsLiveMessage): void {
    if (message.type === "prices") {
      this.#hooks.onPriceRevision();
      return;
    }
    // On the `today` preset the pushed breakdown *is* the picked window, so it
    // patches the tiles outright; a wider window cannot be rebuilt from today
    // alone and only learns that its fetches went stale.
    if (this.#wants("today")) this.#hooks.onToday(message);
    if (!this.#wants("window")) return;
    const now = this.#now();
    if (!shouldRevalidate(this.#lastRevalidateAt, now)) return;
    this.#lastRevalidateAt = now;
    this.#hooks.onRevision();
  }
}
