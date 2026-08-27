/**
 * The subscribe/unsubscribe decision for the multiplexed `/ws` endpoint.
 *
 * Pure functions over data: what the client asked for, and what this session is
 * allowed to have. No socket, no session lookup, no I/O — the route module
 * gathers the facts and this decides, which is what makes the security gate
 * exhaustively testable instead of a claim about wiring.
 *
 * The reason it lives per *frame* rather than per upgrade: one URL serves both
 * the dashboard topics and the admin ones, so the upgrade can only run the
 * weakest policy. Authorization has to be recomputed each time a connection
 * asks for something — a session that expires, or a role revoked, must lose the
 * admin topics on the next `sub` even though the first one succeeded.
 */

import type { ClientFrame, WsTopic } from "@SunReye/contracts/ws";
import { TOPIC_POLICY, isWsTopic } from "./ws-topics";

/** What a session may read, evaluated fresh for one frame. */
export interface TopicAccess {
  /** Dashboard-gated topics: any session, or anonymous public dashboard. */
  dashboard: boolean;
  /** Admin-gated topics: an admin session, never the public exemption. */
  admin: boolean;
}

/** The outcome of one `sub` frame. */
export interface SubscribeDecision {
  /** Topics to attach to this connection, in request order, deduplicated. */
  subscribe: WsTopic[];
  /**
   * Topics refused, named back verbatim — including strings that are not
   * topics at all. A client that mistyped a topic (or speaks a newer
   * vocabulary) must be able to tell "refused" from "subscribed but idle";
   * dropping the name silently makes those two indistinguishable.
   */
  denied: string[];
}

/**
 * Turn a session into the two booleans the policy table is read against.
 *
 * Pure so the one mistake that matters — the public read-only dashboard
 * accidentally granting an admin topic — is a test, not a code review.
 */
export function topicAccessFrom(
  user: { role?: string | null } | null | undefined,
  publicDashboard: boolean,
): TopicAccess {
  const admin = user?.role === "admin";
  return { dashboard: admin || Boolean(user) || publicDashboard, admin };
}

/** Whether `access` clears the gate `topic` sits behind. */
const allows = (access: TopicAccess, topic: WsTopic): boolean =>
  TOPIC_POLICY[topic] === "admin" ? access.admin : access.dashboard;

/**
 * How much of a rejected entry is echoed back in `denied`.
 *
 * The echo exists so a client can tell "refused" from "subscribed but idle",
 * and no real topic name is anywhere near this long. Without the cap, a frame
 * carrying one multi-megabyte string would have the server serialise it
 * straight back to whoever sent it — anonymously reachable while the public
 * dashboard is on.
 */
const MAX_DENIED_NAME = 64;

/**
 * Name a wire value for the `denied` echo, without trusting it to name itself.
 *
 * `String(value)` invokes `toString`/`valueOf`, and `{"toString":1,"valueOf":2}`
 * — plain JSON, so it survives the parse — makes that a `TypeError`. Thrown out
 * of the message handler it aborted the frame with the connection's state half
 * mutated and no ack sent. Denial has to be the outcome for *every* entry that
 * is not a topic, including the ones that refuse to be printed.
 */
function denialName(value: unknown): string {
  if (typeof value === "string") return value.slice(0, MAX_DENIED_NAME);
  try {
    return String(value).slice(0, MAX_DENIED_NAME);
  } catch {
    return "[unnameable]";
  }
}

/**
 * Decide one `sub` frame.
 *
 * `topics` is typed `unknown[]` on purpose: it arrives off the wire, so an
 * entry may be a typo, a number, or an object that throws when stringified.
 * Every such entry is denied by name rather than thrown — a malformed frame
 * must never take the connection down, and must never fall through to a
 * subscribe. The list itself is expected to be capped by
 * {@link parseClientFrame} before it gets here.
 */
export function resolveSubscribe(
  topics: readonly unknown[],
  access: TopicAccess,
): SubscribeDecision {
  const subscribe: WsTopic[] = [];
  const denied: string[] = [];
  // Deduplicate on the requested name, so two components on a page asking for
  // the same topic in one frame produce one subscribe (and one backfill). Two
  // distinct junk entries sharing a truncated prefix collapse into one denial,
  // which is harmless: both were refused anyway.
  const seen = new Set<string>();

  for (const requested of topics) {
    const name = denialName(requested);
    if (seen.has(name)) continue;
    seen.add(name);

    if (isWsTopic(requested) && allows(access, requested)) subscribe.push(requested);
    else denied.push(name);
  }

  return { subscribe, denied };
}

/**
 * Decide one `unsub` frame: the topics this connection actually holds.
 *
 * Unsubscribing something never subscribed is a no-op rather than an error —
 * a component tearing down does not know what its siblings still want, so a
 * redundant `unsub` is normal traffic, not a fault.
 */
export function resolveUnsubscribe(
  topics: readonly unknown[],
  subscribed: ReadonlySet<WsTopic>,
): WsTopic[] {
  const dropped: WsTopic[] = [];
  for (const requested of topics) {
    if (!isWsTopic(requested)) continue;
    if (!subscribed.has(requested)) continue;
    if (dropped.includes(requested)) continue;
    dropped.push(requested);
  }
  return dropped;
}

/**
 * How many topic entries one frame may carry.
 *
 * There are five topics. Bun's default payload limit is 16 MB, so an unbounded
 * list means a single anonymous frame can buy ~2M loop iterations, a Set and a
 * `denied` array of the same size, and a JSON serialisation of all of it back
 * out over the socket. The cap is generous against any honest client (a page
 * asks for at most the five, and duplicates are deduplicated after this point)
 * and flat against a hostile one.
 */
// fallow-ignore-next-line unused-export -- exported for its test, which pins the cap by name rather than repeating the literal
export const MAX_FRAME_TOPICS = 64;

/**
 * Read one client→server frame off the wire, or `null` if it is not one.
 *
 * Elysia hands the handler a parsed object when the payload is JSON and the raw
 * string otherwise, so both are accepted. Anything that fails to parse or fails
 * the shape check is rejected quietly: an unrecognised frame is a client-side
 * defect, and closing the socket over it would take the working topics down
 * with it.
 *
 * An over-long topic list is truncated rather than rejected, for the same
 * reason: the honest prefix of a frame from a buggy client still works, and no
 * legitimate client can reach {@link MAX_FRAME_TOPICS} in the first place.
 */
export function parseClientFrame(raw: unknown): ClientFrame | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object") return null;
  const frame = value as { t?: unknown; topics?: unknown };
  if (frame.t !== "sub" && frame.t !== "unsub") return null;
  if (!Array.isArray(frame.topics)) return null;

  // The topic entries stay unvalidated here — `resolveSubscribe` denies the
  // ones that are not topics, by name, which is more useful than dropping the
  // whole frame because one entry was junk.
  const topics = (
    frame.topics.length > MAX_FRAME_TOPICS ? frame.topics.slice(0, MAX_FRAME_TOPICS) : frame.topics
  ) as WsTopic[];
  return { t: frame.t, topics };
}
