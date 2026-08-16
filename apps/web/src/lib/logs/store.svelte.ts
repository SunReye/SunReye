import type { LogEntry } from "@SunReye/contracts/logs";
import { bus } from "$lib/ws/bus.svelte";
import { type LogFeed, ingestBatch, releaseHeld } from "./feed";

export type { LogEntry };

/**
 * Server log stream on the client (admin-only). Transport is not this store's
 * business: it takes a `logs` lease on the app's one socket ({@link bus}) and
 * gets batches of lines — the bus owns reconnection, the replay of the
 * subscription after a drop, and the "are we live?" answer the badge reads.
 *
 * `paused` freezes the visible feed so an operator can read/scroll without the
 * tail jumping. Incoming lines keep arriving while paused — they're held aside
 * and folded back in (in order) on resume, with {@link pendingCount} surfacing
 * how many are waiting.
 *
 * The buffer arithmetic, including the reconnect-replay dedupe, lives in
 * `feed.ts` where the suite can reach it.
 */
class LogStore {
  /** Visible log lines, oldest first. */
  lines = $state<LogEntry[]>([]);
  /** When true, new lines are held instead of appended to {@link lines}. */
  paused = $state(false);
  /** Lines received while paused, awaiting resume. */
  pendingCount = $state(0);

  #held: LogEntry[] = [];

  /** Live/offline for the status badge — one connection, one answer. */
  get connected(): boolean {
    return bus.connected;
  }

  /**
   * Lease the `logs` topic from a component `$effect`; returns the cleanup. No
   * socket is opened or closed here — the app shell holds that lease.
   */
  lease(): () => void {
    return bus.subscribe("logs", (batch) => this.#apply(batch));
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.#commit(releaseHeld(this.#feed()));
  }

  clear(): void {
    this.lines = [];
    this.#held = [];
    this.pendingCount = 0;
  }

  #feed(): LogFeed {
    // `lines` is a reactive proxy; `feed.ts` only ever reads it.
    return { lines: this.lines, held: this.#held };
  }

  #apply(batch: LogEntry[]): void {
    this.#commit(ingestBatch(this.#feed(), batch, this.paused));
  }

  /** Write back only what moved: a fully-replayed batch must cost no re-render. */
  #commit(next: LogFeed): void {
    if (next.lines !== this.lines) this.lines = next.lines;
    this.#held = next.held;
    if (next.held.length !== this.pendingCount) this.pendingCount = next.held.length;
  }
}

export const logs = new LogStore();
