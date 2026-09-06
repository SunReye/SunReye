/**
 * The read-side bus's only sink: every live payload, enveloped and published to
 * the `/ws` subscribers of its topic.
 *
 * Producers emit onto the bus; this wiring pushes to the browser. It is the
 * publishing half of a pair — {@link ./ws-connection} joins each connection to
 * `ws.subscribe(topic)`, this publishes to `server.publish(topic)` — and the two
 * agree on nothing but a string. Drift between them is invisible in production:
 * the socket opens, every `sub` is acked, and no frame ever arrives. It lives in
 * its own module (rather than inline in `index.ts`, where a test cannot reach
 * it) so that string is pinned on both sides.
 *
 * `logs` is the one topic whose bus payload (a single {@link LogEntry}) differs
 * from its wire payload (a batch), and the flush below is the single place that
 * conversion happens.
 */

import type { LogEntry } from "@SunReye/contracts/logs";
import type { WsTopic, WsTopicPayloads } from "@SunReye/contracts/ws";
import type { Streams } from "../shared/streams";
import { wsFrame } from "./ws-topics";

/**
 * How long log lines are collected before one frame goes out.
 *
 * Startup and error storms emit many lines at once, so a burst is batched into
 * one message rather than a WebSocket frame per line. The coalescing is a socket
 * concern, which is why it sits here at the boundary and not in the producer.
 */
const LOG_FLUSH_MS = 250;

/** The publish surface of the running server — Bun's pub/sub, structurally. */
export interface TopicPublisher {
  publish(topic: string, message: string): unknown;
}

export interface LivePublishDeps {
  /** The read-side bus every producer emits onto. */
  streams: Streams;
  /**
   * The live server, re-read per emit. `app.server` does not exist until
   * `.listen()` resolves, and the bus is wired before that — a boot-time log
   * line is already flowing while this answers undefined.
   */
  publisher: () => TopicPublisher | undefined;
  /** Override for {@link LOG_FLUSH_MS}; the tests use it to not wait. */
  logFlushMs?: number;
}

/** Wire every live topic from the bus to its `/ws` subscribers. */
export function publishLiveTopics(deps: LivePublishDeps): void {
  /** Publish one topic-tagged frame; a no-op until the server is listening. */
  const publish = <K extends WsTopic>(topic: K, data: WsTopicPayloads[K]) =>
    deps.publisher()?.publish(topic, wsFrame(topic, data));

  deps.streams.subscribe("metrics", (data) => publish("metrics", data));
  deps.streams.subscribe("plant", (data) => publish("plant", data));
  deps.streams.subscribe("evcc", (data) => publish("evcc", data));
  deps.streams.subscribe("statistics", (data) => publish("statistics", data));
  deps.streams.subscribe("automations", (data) => publish("automations", data));

  const queue: LogEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  deps.streams.subscribe("logs", (entry) => {
    queue.push(entry);
    // A window is already open: this line rides it rather than arming a second.
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      // Draining is what keeps a window from republishing lines the last one
      // already sent; the queue is only ever refilled by a line that arms the
      // next window, so a flush always carries at least one entry.
      publish("logs", queue.splice(0));
    }, deps.logFlushMs ?? LOG_FLUSH_MS);
  });
}
