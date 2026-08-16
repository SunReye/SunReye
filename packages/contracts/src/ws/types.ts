/**
 * The WebSocket frame vocabulary shared by the server and the web app.
 *
 * The five live feeds (metrics, EVCC, statistics, automations, logs) used to be
 * five separate sockets, each with its own untyped `JSON.parse(...) as …` on
 * the browser side. They ride one multiplexed connection instead: the client
 * sends {@link ClientFrame}s to say which topics it wants, the server answers
 * with {@link ServerFrame}s tagged by topic. Tagging the payload with the topic
 * is what lets the browser narrow — one `switch` on `frame.topic` and `data` is
 * the right shape, checked rather than cast.
 *
 * {@link WsTopicPayloads} is the single definition site for the topic→payload
 * mapping: the server's `shared/streams.ts` derives its bus topics from it
 * (with the one deliberate override noted below), so a payload can no longer
 * drift between what a producer emits and what the wire promises.
 *
 * Type-only — no runtime tail (see AGENTS.md).
 */

import type { InverterSample } from "@SunReye/inverter-core";
import type { AutomationStreamMessage } from "../automation/types";
import type { EvccState } from "../evcc/types";
import type { LogEntry } from "../logs/types";
import type { StatisticsLiveMessage } from "../statistics/types";

/**
 * Every live topic and the payload its frames carry **on the wire**.
 *
 * `logs` is the one array-valued topic, and deliberately so: log lines arrive
 * in bursts, so they are coalesced at the socket boundary into one frame per
 * flush. Every other topic publishes a single object per emit.
 */
export interface WsTopicPayloads {
  metrics: InverterSample;
  evcc: EvccState;
  statistics: StatisticsLiveMessage;
  automations: AutomationStreamMessage;
  logs: LogEntry[];
}

/** The name of a live topic a client may subscribe to. */
export type WsTopic = keyof WsTopicPayloads;

/**
 * One server→client data frame, distributed over the topics so that narrowing
 * on `topic` narrows `data` with it. Written as a mapped type indexed by
 * {@link WsTopic} rather than by hand, so a new topic joins the union for free.
 */
export type ServerFrame = {
  [K in WsTopic]: { topic: K; data: WsTopicPayloads[K] };
}[WsTopic];

/**
 * The server's answer to a subscribe request.
 *
 * `__ack` is not a {@link WsTopic} — it is a control frame on the same
 * connection, and the leading underscores keep it outside the topic namespace
 * so no client can subscribe to it. `denied` carries the topics the session was
 * not allowed to have (logs are admin-only), which is how the client learns the
 * difference between "subscribed but idle" and "never coming".
 */
export type ServerAckFrame = {
  topic: "__ack";
  data: {
    /** Topics now flowing to this connection. */
    subscribed: WsTopic[];
    /**
     * Topics refused for this session, typically for lack of privilege, named
     * back verbatim. Typed `string[]` rather than `WsTopic[]` because a request
     * for a topic that does not exist — a typo, or a newer client's vocabulary —
     * is refused too, and echoing the name is what lets the client tell
     * "refused" from "subscribed but idle". Silence cannot distinguish them.
     */
    denied: string[];
  };
};

/**
 * One client→server control frame. `sub`/`unsub` are additive and removing:
 * a connection's subscription set is the accumulation of them, never replaced
 * wholesale, so two independent components on a page can each ask for what they
 * need without knowing about each other.
 */
export type ClientFrame = { t: "sub"; topics: WsTopic[] } | { t: "unsub"; topics: WsTopic[] };
