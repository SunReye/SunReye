/**
 * Reactive shell over {@link LiveBus} — the app's one live socket.
 *
 * Everything that can be wrong lives in `bus.ts`, which is plain TS and fully
 * tested; runes do not run under `bun test` (see `apps/web/TESTING.md`). This
 * file only mirrors the bus's two facts into `$state` and injects the real
 * transport.
 */

import { browser } from "$app/environment";
import type { WsTopic, WsTopicPayloads } from "@SunReye/contracts/ws";
import { api } from "$lib/api";
import { LiveBus } from "./bus";

class LiveBusStore {
  /** The app's single "are we live?" answer. */
  connected = $state(false);

  /**
   * Exponentially-smoothed spacing between metrics frames (ms) — the one
   * animation clock. `AnimatedNumber` and the live chart cursor stretch their
   * per-frame glide across it, so values drift continuously between samples
   * instead of snapping and then freezing until the next one. Seeds at the
   * nominal 1 Hz feed; the poll interval is configurable from 1 s to 1 h.
   */
  cadenceMs = $state(1000);

  #bus = new LiveBus({
    // Eden derives this from the server's `.ws("/ws", …)` route.
    create: () => api.ws.subscribe(),
    onConnected: (connected) => {
      this.connected = connected;
    },
    onCadence: (cadenceMs) => {
      this.cadenceMs = cadenceMs;
    },
  });

  /**
   * Lease the connection. Held **once**, by the app shell — a page or a card
   * wants {@link subscribe}, which costs no socket.
   */
  connect(): () => void {
    // No transport under SSR/prerender; the shell's `$effect` only runs in the
    // browser, but `connect()` must be safe to call anywhere.
    if (!browser) return () => {};
    return this.#bus.connect();
  }

  /** Receive one topic's frames until the returned disposer runs. */
  subscribe<K extends WsTopic>(topic: K, on: (data: WsTopicPayloads[K]) => void): () => void {
    if (!browser) return () => {};
    return this.#bus.subscribe(topic, on);
  }
}

export const bus = new LiveBusStore();
