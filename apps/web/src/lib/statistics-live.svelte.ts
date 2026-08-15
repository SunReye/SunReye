import type { StatisticsLiveMessage, StatisticsTodayMessage } from "@SunReye/contracts/statistics";
import { api } from "$lib/api";
import { liveModeFor, shouldRevalidate, type LiveMode } from "$lib/statistics/live";
import type { CostRange } from "$lib/cost/ranges";
import { ReconnectingSocket } from "$lib/ws/reconnecting-socket";

/**
 * The Statistics page's live feed (`/ws/statistics`). The server republishes
 * today's cost breakdown and energy split every 15 s — but only while someone
 * is subscribed — and a bare `prices` signal after a spot-price sync.
 *
 * Two ways to consume a push, picked by the page's range ({@link LiveMode}):
 *
 * - `today`: the pushed breakdown *is* the picked window, so {@link today}
 *   patches the tiles directly and nothing is refetched.
 * - `window`: a wider now-inclusive range (7 days, this month, this year) can't
 *   be reconstructed from today alone, so a push only bumps {@link revision} —
 *   a shared invalidation signal the range-wide fetch effects depend on —
 *   throttled to at most one refetch a minute.
 *
 * Past-only ranges take no lease at all, which leaves the server with zero
 * subscribers and skips its interval job entirely.
 */
class StatisticsLiveStore {
  /** Latest pushed snapshot while a `today` lease is held; null otherwise. */
  today = $state<StatisticsTodayMessage | null>(null);
  /**
   * Bumped when the range-wide reads (comparison + the sections' series) should
   * refetch. Read it inside a fetch `$effect` to opt that fetch in.
   */
  revision = $state(0);
  /** Bumped when a spot-price sync stored fresh slots. Everything price-derived
   *  (the price panel, the spot analytics reads) is stale at that point. */
  priceRevision = $state(0);
  /** Whether the stream is currently connected — what the page's live dot
   *  shows. Cleared on a drop, which the socket also reports when the last
   *  lease goes away, so a past-only range reads as "not live" rather than
   *  leaving a stale dot lit. */
  connected = $state(false);

  /** How the current lease consumes pushes. */
  #mode: LiveMode = "today";
  /** Wall clock of the last {@link revision} bump — the throttle's memory. */
  #lastRevalidateAt: number | null = null;

  #socket = new ReconnectingSocket({
    create: () => api.ws.statistics.subscribe(),
    onMessage: (raw) => {
      const message = (typeof raw === "string" ? JSON.parse(raw) : raw) as StatisticsLiveMessage;
      this.#apply(message);
    },
    // A drop (or the last lease going away) must not leave a frozen snapshot
    // patched over the tiles: fall back to the fetched figures until the next
    // open, which the server answers with a fresh snapshot immediately.
    onOpen: () => {
      this.connected = true;
    },
    onDrop: () => {
      this.connected = false;
      this.today = null;
    },
  });

  #apply(message: StatisticsLiveMessage): void {
    if (message.type === "prices") {
      this.priceRevision += 1;
      return;
    }
    if (this.#mode === "today") {
      this.today = message;
      return;
    }
    const now = Date.now();
    if (!shouldRevalidate(this.#lastRevalidateAt, now)) return;
    this.#lastRevalidateAt = now;
    this.revision += 1;
  }

  /**
   * Lease the stream for a now-inclusive range from a component `$effect`;
   * returns the cleanup that releases it. Call it only for a range that
   * `includesNow` — a past-only range must hold no lease.
   */
  lease(range: CostRange): () => void {
    this.#mode = liveModeFor(range);
    // The page has just fetched this window, so the throttle starts closed and
    // the first invalidation lands a minute in rather than on the open snapshot.
    this.#lastRevalidateAt = Date.now();
    return this.#socket.connect();
  }
}

export const statisticsLive = new StatisticsLiveStore();
