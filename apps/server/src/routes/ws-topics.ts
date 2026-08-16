/**
 * The access policy of every live WebSocket topic.
 *
 * The five feeds used to be five URLs, and each URL carried its own guard
 * (`requireSession` for the dashboard three, `requireAdmin` for logs and
 * automations). One multiplexed URL cannot do that — the upgrade can only run a
 * single policy — so the policy moves from the route table to this table, and
 * is applied per subscribe frame in {@link ./ws-subscribe}.
 *
 * `satisfies Record<WsTopic, TopicPolicy>` is the load-bearing part: a topic
 * added to the wire contract without a row here does not compile. That is the
 * difference between "we remembered to gate it" and "it cannot ship ungated" —
 * and the failure mode being guarded is a kiosk display receiving the log
 * firehose (config values, hostnames, error internals).
 */

import type { WsTopic } from "@SunReye/contracts/ws";

/**
 * How a topic is gated.
 *
 * - `dashboard` — the same policy as an HTTP dashboard read: any session, or
 *   anonymous when the public read-only dashboard is enabled.
 * - `admin` — an admin session, always. Never rides the public exemption.
 */
type TopicPolicy = "dashboard" | "admin";

/** The gate each live topic sits behind. Exhaustive over {@link WsTopic}. */
export const TOPIC_POLICY = {
  metrics: "dashboard",
  evcc: "dashboard",
  statistics: "dashboard",
  logs: "admin",
  automations: "admin",
} as const satisfies Record<WsTopic, TopicPolicy>;

/**
 * Whether an arbitrary value names a real topic.
 *
 * `Object.hasOwn`, not `in`: `"constructor" in TOPIC_POLICY` is true, and a
 * prototype-chain hit would turn `Object.prototype` members into topics whose
 * "policy" is a function — never equal to `"admin"`, so it would read as
 * dashboard-gated. Own keys only.
 */
export function isWsTopic(value: unknown): value is WsTopic {
  return typeof value === "string" && Object.hasOwn(TOPIC_POLICY, value);
}

/**
 * Whether live payloads for a topic are buffered while its snapshot is read.
 *
 * Every topic but `logs` is: the snapshot is an awaited query, so there is a
 * real window for a live frame to overtake it. `logs` opts out because it is
 * the one topic whose bus payload (a single entry) differs from its wire
 * payload (a coalesced batch) — a buffered `LogEntry` cannot be sent on a
 * channel that carries `LogEntry[]` — and because its snapshot is the in-memory
 * ring buffer, read synchronously, so the window it would cover is empty.
 *
 * Not buffering does *not* make the feed duplicate-free: `recentLogs()` returns
 * lines that are still sitting in the 250 ms flush queue, and that flush
 * publishes the same batch to the `logs` topic, so a client priming mid-window
 * sees those lines twice either way. That is exactly what the five old routes
 * did, so it is parity rather than a regression — dedup belongs with the
 * coalescing step, not here.
 */
export const bufferedWhilePriming = (topic: WsTopic): boolean => topic !== "logs";
