/**
 * The subscribe decision for the multiplexed `/ws` socket.
 *
 * One URL cannot carry five different access policies, so the upgrade rides the
 * weakest one (a dashboard read, anonymous when the public dashboard is on) and
 * the *real* gate is here, per subscribe frame. That makes this file the
 * security surface of the whole endpoint: a bug that lets `logs` through hands
 * a kiosk viewer the server's config values, hostnames and error internals.
 *
 * Everything proven here is a pure function over data — no socket, no session
 * lookup — precisely so the gate can be tested exhaustively instead of being
 * inspected in a wiring diagram.
 */

import { describe, expect, test } from "bun:test";
import {
  MAX_FRAME_TOPICS,
  parseClientFrame,
  resolveSubscribe,
  resolveUnsubscribe,
  topicAccessFrom,
} from "./ws-subscribe";

/** Access of a logged-out visitor while the public read-only dashboard is on. */
const anonViewer = { dashboard: true, admin: false };
/** Access of a signed-in admin: everything. */
const admin = { dashboard: true, admin: true };
/** Access of a logged-out visitor with the dashboard locked down: nothing. */
const stranger = { dashboard: false, admin: false };

describe("resolveSubscribe", () => {
  test("an anonymous dashboard viewer asking for logs is denied and stays subscribed to nothing", () => {
    expect(resolveSubscribe(["logs"], anonViewer)).toEqual({ subscribe: [], denied: ["logs"] });
  });

  test("an anonymous dashboard viewer gets the dashboard topics and nothing else", () => {
    expect(resolveSubscribe(["metrics", "logs", "evcc", "automations"], anonViewer)).toEqual({
      subscribe: ["metrics", "evcc"],
      denied: ["logs", "automations"],
    });
  });

  test("an admin gets every topic it asks for", () => {
    expect(resolveSubscribe(["logs", "automations", "metrics"], admin)).toEqual({
      subscribe: ["logs", "automations", "metrics"],
      denied: [],
    });
  });

  test("a locked-down anonymous visitor is denied even the dashboard topics", () => {
    expect(resolveSubscribe(["metrics", "statistics"], stranger)).toEqual({
      subscribe: [],
      denied: ["metrics", "statistics"],
    });
  });

  test("duplicate topics in one frame subscribe once", () => {
    // A page with two components each asking for `metrics` must not make the
    // socket subscribe twice — the second subscribe would be a silent no-op on
    // the pub/sub side but would re-run the backfill and re-send the snapshot.
    expect(resolveSubscribe(["metrics", "metrics", "metrics"], anonViewer)).toEqual({
      subscribe: ["metrics"],
      denied: [],
    });
  });

  test("a duplicated denied topic is reported once", () => {
    expect(resolveSubscribe(["logs", "logs"], anonViewer)).toEqual({
      subscribe: [],
      denied: ["logs"],
    });
  });

  test("an unknown topic string is denied, never thrown", () => {
    // A typo'd or newer-client topic must come back named in `denied` rather
    // than vanish: silence is indistinguishable from "subscribed but idle".
    expect(resolveSubscribe(["metrics", "nonsense"], anonViewer)).toEqual({
      subscribe: ["metrics"],
      denied: ["nonsense"],
    });
  });

  test("a non-string topic entry is denied rather than crashing the connection", () => {
    expect(resolveSubscribe([null, 7, { topic: "logs" }, "metrics"], admin)).toEqual({
      subscribe: ["metrics"],
      denied: ["null", "7", "[object Object]"],
    });
  });

  test("an entry that throws when stringified is denied rather than crashing the connection", () => {
    // `{"toString":1,"valueOf":2}` is plain JSON, so it arrives intact and then
    // makes ToPrimitive throw. Naming the entry ran *before* the topic guard,
    // so the TypeError escaped the message handler: the frame aborted with the
    // connection's state half-mutated and no ack ever sent. Anonymous traffic
    // must never be able to do that.
    expect(resolveSubscribe([{ toString: 1, valueOf: 2 }, "metrics"], admin)).toEqual({
      subscribe: ["metrics"],
      denied: ["[unnameable]"],
    });

    expect(resolveSubscribe([Object.create(null)], admin)).toEqual({
      subscribe: [],
      denied: ["[unnameable]"],
    });
  });

  test("a denied name is truncated before it is echoed back", () => {
    // Otherwise the server serialises a multi-megabyte string straight back to
    // whoever sent it, for free.
    const [name] = resolveSubscribe(["x".repeat(100_000)], admin).denied;

    expect(name?.length).toBeLessThanOrEqual(64);
  });

  test("an inherited property name is not a topic", () => {
    // `"constructor" in TOPIC_POLICY` is true; the policy lookup must not be.
    expect(resolveSubscribe(["constructor", "toString"], admin)).toEqual({
      subscribe: [],
      denied: ["constructor", "toString"],
    });
  });

  test("an empty frame subscribes to nothing and denies nothing", () => {
    expect(resolveSubscribe([], admin)).toEqual({ subscribe: [], denied: [] });
  });

  test("authorization is recomputed per frame, so a revoked role loses the topic", () => {
    // The whole point of deciding here rather than at upgrade: the same
    // request, asked twice with different access, must answer differently.
    const first = resolveSubscribe(["logs"], admin);
    const second = resolveSubscribe(["logs"], anonViewer);

    expect(first.subscribe).toEqual(["logs"]);
    expect(second.subscribe).toEqual([]);
    expect(second.denied).toEqual(["logs"]);
  });
});

describe("resolveUnsubscribe", () => {
  test("only topics this connection actually holds are unsubscribed", () => {
    expect(resolveUnsubscribe(["metrics", "evcc"], new Set(["metrics"] as const))).toEqual([
      "metrics",
    ]);
  });

  test("unsubscribing a topic that was never subscribed is a no-op", () => {
    expect(resolveUnsubscribe(["logs"], new Set())).toEqual([]);
  });

  test("an unknown topic string is ignored rather than thrown", () => {
    expect(resolveUnsubscribe(["nonsense", 3, null], new Set(["metrics"] as const))).toEqual([]);
  });

  test("a duplicated topic is unsubscribed once", () => {
    expect(resolveUnsubscribe(["metrics", "metrics"], new Set(["metrics"] as const))).toEqual([
      "metrics",
    ]);
  });
});

describe("topicAccessFrom", () => {
  test("an admin session unlocks both the dashboard and the admin topics", () => {
    expect(topicAccessFrom({ role: "admin" }, false)).toEqual({ dashboard: true, admin: true });
  });

  test("a non-admin session reads the dashboard only", () => {
    expect(topicAccessFrom({ role: "user" }, false)).toEqual({ dashboard: true, admin: false });
  });

  test("no session reads the dashboard only while the public dashboard is on", () => {
    expect(topicAccessFrom(null, true)).toEqual({ dashboard: true, admin: false });
  });

  test("no session and a locked-down dashboard reads nothing", () => {
    expect(topicAccessFrom(null, false)).toEqual({ dashboard: false, admin: false });
  });

  test("the public dashboard never grants the admin topics", () => {
    // The one mistake that would leak the log firehose to a wall display.
    expect(topicAccessFrom(null, true).admin).toBe(false);
    expect(topicAccessFrom({ role: "user" }, true).admin).toBe(false);
  });
});

describe("parseClientFrame", () => {
  test("a sub frame arrives as a JSON string from the browser", () => {
    expect(parseClientFrame(JSON.stringify({ t: "sub", topics: ["metrics"] }))).toEqual({
      t: "sub",
      topics: ["metrics"],
    });
  });

  test("a frame Elysia already parsed is taken as-is", () => {
    expect(parseClientFrame({ t: "unsub", topics: ["logs"] })).toEqual({
      t: "unsub",
      topics: ["logs"],
    });
  });

  test("malformed JSON is rejected instead of throwing", () => {
    expect(parseClientFrame("{not json")).toBeNull();
  });

  test("a frame with an unknown verb is rejected", () => {
    expect(parseClientFrame({ t: "publish", topics: ["metrics"] })).toBeNull();
  });

  test("an over-long topic list is truncated to the cap", () => {
    // Five topics exist; the payload limit is 16 MB. Without the cap, one
    // anonymous frame buys millions of iterations and a `denied` array of the
    // same size serialised back out over the socket.
    const frame = parseClientFrame({
      t: "sub",
      topics: Array.from({ length: 10_000 }, (_, index) => `topic-${index}`),
    });

    expect(frame?.topics).toHaveLength(MAX_FRAME_TOPICS);
    expect(frame?.topics[0]).toBe("topic-0" as never);
  });

  test("a topic list within the cap is passed through untouched", () => {
    const topics = ["metrics", "evcc"];
    expect(parseClientFrame({ t: "sub", topics })?.topics).toEqual(topics as never);
  });

  test("a frame without a topic list is rejected", () => {
    expect(parseClientFrame({ t: "sub" })).toBeNull();
    expect(parseClientFrame({ t: "sub", topics: "metrics" })).toBeNull();
    expect(parseClientFrame(null)).toBeNull();
    expect(parseClientFrame(42)).toBeNull();
  });
});
