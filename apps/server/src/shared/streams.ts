/**
 * The read-side stream bus.
 *
 * Every live feed the server pushes to a WebSocket — the metrics sample, the
 * EVCC snapshot, log lines, the automation tick, the statistics signal — used
 * to be its own hand-rolled, single-subscriber module `let listener`, set once
 * from `index.ts` and reset by hand in five different test files. This is the
 * one typed publish/subscribe seam that replaces all of them: producers
 * `emit(topic, payload)` and the socket layer `subscribe(topic, …)`s, with the
 * topic→payload types checked at the call site.
 *
 * It is a **factory**, not a module singleton: `index.ts` owns the single live
 * instance and injects it into the producers. Collapsing five small globals
 * into one big global would not have been progress — a `createStreams()` bus is
 * isolated, so two servers in one process (a dev simulator beside a real one)
 * and every test get their own, with no cross-talk and nothing to reset.
 *
 * Read-side only. Register writes stay awaited calls through `runtime.write`;
 * nothing on the write path emits here.
 */

import type { WsTopicPayloads } from "@SunReye/contracts/ws";
import type { LogEntry } from "@SunReye/contracts/logs";

/**
 * Every live topic and the payload one emit carries.
 *
 * Derived from the wire mapping rather than restated, so a topic can never mean
 * one thing to a producer and another to the browser. The single override is
 * the real divergence: producers emit **one** log entry at a time, while the
 * wire carries a batch — log lines are coalesced at the socket boundary, not
 * upstream of the bus. Encoding that here means the coalescing step is the one
 * place a `LogEntry` becomes a `LogEntry[]`, and the compiler says so.
 */
export type StreamTopics = Omit<WsTopicPayloads, "logs"> & { logs: LogEntry };

/** A subscriber to one topic. */
export type StreamListener<K extends keyof StreamTopics> = (payload: StreamTopics[K]) => void;

export interface Streams {
  /** Push one payload to every current subscriber of `topic`. */
  emit<K extends keyof StreamTopics>(topic: K, payload: StreamTopics[K]): void;
  /** Register a subscriber; the returned function detaches it. */
  subscribe<K extends keyof StreamTopics>(topic: K, listener: StreamListener<K>): () => void;
}

/**
 * A fresh, isolated bus. The per-topic subscriber sets are stored loosely (the
 * public methods keep the topic↔payload types precise); a topic with no
 * subscribers simply has no set until its first `subscribe`.
 */
export function createStreams(): Streams {
  type AnyListener = (payload: never) => void;
  const listeners = new Map<keyof StreamTopics, Set<AnyListener>>();

  return {
    emit(topic, payload) {
      const set = listeners.get(topic);
      if (!set) return;
      // Snapshot so a subscriber that (un)subscribes mid-emit doesn't alter the
      // set being iterated, and isolate each call — one broken subscriber (a
      // closed socket) must lose neither the emit nor the other subscribers.
      for (const listener of Array.from(set)) {
        try {
          (listener as StreamListener<typeof topic>)(payload);
        } catch {
          // Swallowed on purpose: a throwing subscriber is a downstream defect,
          // never a reason to drop a sample for everyone else.
        }
      }
    },

    subscribe(topic, listener) {
      let set = listeners.get(topic);
      if (!set) {
        set = new Set();
        listeners.set(topic, set);
      }
      const registered = listener as AnyListener;
      set.add(registered);
      return () => {
        set.delete(registered);
      };
    },
  };
}
