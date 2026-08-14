/**
 * The automations live stream: one WebSocket (`/ws/automations`) shared by the
 * index badge and the peak-shaving page — it replaces the status/history/plan
 * polls. The server pushes a frame after every engine tick (status, the
 * decision point it logged, the recomputed plan); the socket's `open` handler
 * replays a full snapshot including the whole decision ring so a subscriber
 * paints immediately. An HTTP backfill on each (re)open covers the handshake
 * window and heals any offline gap ({@link ReconnectingSocket} reconnects with
 * backoff while at least one lease is live).
 */

import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";
import { ReconnectingSocket } from "$lib/ws/reconnecting-socket";
import type {
  AutomationHistoryView,
  AutomationPlanView,
  AutomationStatusView,
  AutomationStreamMessage,
  DecisionPoint,
  PeakShavingPlans,
  PeakShavingStatus,
} from "$lib/automations";

class AutomationStream {
  status = $state<PeakShavingStatus | null>(null);
  /** Decision ring, oldest → newest — snapshot-seeded, then grown per tick. */
  history = $state<DecisionPoint[]>([]);
  plan = $state<PeakShavingPlans | null>(null);
  /** Engine cadence, ms — the countdown base for "next decision in …". */
  tickMs = $state(30_000);
  /**
   * Client-clock arrival of the last frame that carried a fresh tick — the
   * countdown anchor. Deliberately not the server's `lastTickAt`: the viewer's
   * clock and the server's can disagree, and a skew larger than the interval
   * would pin the countdown at 0.
   */
  tickArrivedAt = $state<number | null>(null);
  /** True once a first payload (fetch or socket) has arrived. */
  loaded = $state(false);
  /** Live socket state, for the page's connection indicator. */
  connected = $state(false);
  /** Ring capacity, mirrored from the history endpoint's declared size. */
  #capacity = 2_880;

  #socket = new ReconnectingSocket({
    create: () => api.ws.automations.subscribe(),
    // Fresh connection: backfill over the pre-handshake window / offline gap.
    onStart: () => void this.#refresh(),
    onOpen: () => {
      this.connected = true;
    },
    onDrop: () => {
      this.connected = false;
    },
    onMessage: (raw) => {
      const msg = (typeof raw === "string" ? JSON.parse(raw) : raw) as AutomationStreamMessage;
      this.#apply(msg);
    },
  });

  #apply(msg: AutomationStreamMessage): void {
    // Countdown anchor: the client-clock arrival of a frame carrying a fresh
    // tick. Server timestamps must never be compared against the viewer's
    // clock — any skew between the two machines would pin the countdown.
    if (msg.status.lastTickAt !== this.status?.lastTickAt) {
      this.tickArrivedAt = Date.now();
    }
    this.status = msg.status;
    this.plan = msg.plan;
    this.tickMs = msg.tickMs;
    if (msg.history) this.history = msg.history;
    else this.#appendPoint(msg.point);
    this.loaded = true;
  }

  /** Grow the ring by one tick's point, dropping snapshot/stream duplicates. */
  #appendPoint(point: DecisionPoint | null): void {
    if (!point || point.t === this.history.at(-1)?.t) return;
    this.history = [...this.history.slice(-(this.#capacity - 1)), point];
  }

  /** One-shot HTTP read for the first paint (and the post-reconnect backfill). */
  async #refresh(): Promise<void> {
    const [st, hi, pl] = await Promise.all([
      api.api.automations.status.get(),
      api.api.automations.history.get(),
      api.api.automations.plan.get(),
    ]);
    const hasStatus = this.#applyStatus(payloadOrNull<AutomationStatusView>(st.data));
    const hasHistory = this.#applyHistory(payloadOrNull<AutomationHistoryView>(hi.data));
    if (pl.data) this.plan = (pl.data as AutomationPlanView).peakShaving;
    if (hasStatus || hasHistory) this.loaded = true;
  }

  #applyStatus(view: AutomationStatusView | null): boolean {
    if (!view?.peakShaving) return false;
    this.status = view.peakShaving;
    return true;
  }

  #applyHistory(view: AutomationHistoryView | null): boolean {
    if (!view) return false;
    this.#capacity = view.capacity;
    this.tickMs = view.tickMs;
    this.history = view.peakShaving;
    return true;
  }

  /**
   * Lease the live stream from a component `$effect`; returns the cleanup. Any
   * number of consumers share the one connection.
   */
  connect(): () => void {
    return this.#socket.connect();
  }
}

export const automationStream = new AutomationStream();
