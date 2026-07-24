import type { LogEntry } from "server/src/logging";
import { api } from "$lib/api";

export type { LogEntry };

type LogSocket = ReturnType<typeof api.ws.logs.subscribe>;

/** Reconnect backoff after an unexpected socket drop. */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

/**
 * How many lines to keep in the viewer. The server retains a smaller ring
 * buffer for the on-connect replay; this is the client-side cap on the live
 * feed so a long-lived panel can't grow without bound.
 */
const MAX_LINES = 2000;

/**
 * Server log stream on the client (admin-only, over `/ws/logs`). Mirrors the
 * EVCC store: a single WebSocket is shared via a ref-counted {@link connect}
 * lease and reopened with exponential backoff on drops. The server replays its
 * recent ring buffer on open, then pushes coalesced batches of new lines.
 *
 * `paused` freezes the visible feed so an operator can read/scroll without the
 * tail jumping. Incoming lines keep arriving while paused — they're held aside
 * and folded back in (in order) on resume, with {@link pendingCount} surfacing
 * how many are waiting.
 */
class LogStore {
  /** Visible log lines, oldest first. */
  lines = $state<LogEntry[]>([]);
  /** True while the socket is open (drives the live/offline status badge). */
  connected = $state(false);
  /** When true, new lines are held instead of appended to {@link lines}. */
  paused = $state(false);
  /** Lines received while paused, awaiting resume. */
  pendingCount = $state(0);

  #held: LogEntry[] = [];
  #leases = 0;
  #ws: LogSocket | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;

  /**
   * Lease the live stream from a component `$effect`; returns the cleanup. The
   * socket opens with the first lease and closes with the last.
   */
  connect(): () => void {
    if (this.#leases++ === 0) this.#openSocket();
    return () => {
      if (--this.#leases === 0) this.#teardown();
    };
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    if (this.#held.length > 0) {
      this.#appendVisible(this.#held);
      this.#held = [];
    }
    this.pendingCount = 0;
  }

  clear(): void {
    this.lines = [];
    this.#held = [];
    this.pendingCount = 0;
  }

  /** Ingest a batch of lines: hold them while paused, else show immediately. */
  #ingest(batch: LogEntry[]): void {
    if (batch.length === 0) return;
    if (this.paused) {
      this.#held.push(...batch);
      if (this.#held.length > MAX_LINES) this.#held.splice(0, this.#held.length - MAX_LINES);
      this.pendingCount = this.#held.length;
      return;
    }
    this.#appendVisible(batch);
  }

  #appendVisible(batch: LogEntry[]): void {
    const next = this.lines.concat(batch);
    this.lines = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
  }

  #openSocket(): void {
    this.#teardownSocket();
    const ws = api.ws.logs.subscribe();
    ws.subscribe((message: { data: unknown }) => {
      if (this.#ws !== ws) return; // superseded socket flushing late
      const raw = message.data;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) this.#ingest(parsed as LogEntry[]);
    });
    ws.on("open", () => {
      if (this.#ws !== ws) return;
      this.connected = true;
      this.#reconnectAttempts = 0; // healthy connection resets backoff
    });
    ws.on("close", () => {
      if (this.#ws !== ws) return; // intentional/superseded close — don't retry
      this.#ws = null;
      this.connected = false;
      this.#scheduleReconnect();
    });
    // Surface transport errors as a close so the single reconnect path handles them.
    ws.on("error", () => ws.close());
    this.#ws = ws;
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer !== null || this.#leases === 0) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.#reconnectAttempts);
    this.#reconnectAttempts += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#leases === 0) return;
      this.#openSocket();
    }, delay);
  }

  #teardownSocket(): void {
    const ws = this.#ws;
    this.#ws = null; // drop identity first so its handlers become no-ops
    ws?.close();
  }

  #teardown(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#reconnectAttempts = 0;
    this.connected = false;
    this.#teardownSocket();
  }
}

export const logs = new LogStore();
