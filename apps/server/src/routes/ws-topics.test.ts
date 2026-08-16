/**
 * The topic policy table.
 *
 * The table is the only place the "who may read this feed" question is
 * answered now that the five single-purpose WebSocket routes collapsed into one
 * multiplexed `/ws`. The compiler guarantees the table is *complete*
 * (`satisfies Record<WsTopic, TopicPolicy>` in the source); these tests pin the
 * part the compiler cannot know — which side of the line each topic sits on.
 *
 * `logs` and `automations` being admin-gated is the load-bearing row: logs
 * carry config values, hostnames and error internals, and automations expose
 * what the engine writes to the inverter's registers. Neither may ever ride the
 * public read-only dashboard exemption.
 */

import { describe, expect, test } from "bun:test";
import { TOPIC_POLICY, bufferedWhilePriming, isWsTopic, wsFrame } from "./ws-topics";

/**
 * The topics under test, read back off the table itself. Derived here rather
 * than exported from the source: nothing in production enumerates the topics
 * (the socket only ever looks one up), and an export with no consumer is dead
 * code the audit rightly flags.
 */
const WS_TOPICS = Object.keys(TOPIC_POLICY) as (keyof typeof TOPIC_POLICY)[];

describe("TOPIC_POLICY", () => {
  test("every wire topic has a policy and there are no extras", () => {
    // The type gate is `satisfies Record<WsTopic, TopicPolicy>`; this pins the
    // set at runtime so a topic quietly dropped from the union shows up as a
    // failing test rather than a silently smaller table.
    expect([...WS_TOPICS].sort()).toEqual(["automations", "evcc", "logs", "metrics", "statistics"]);
  });

  test("logs and automations are the admin-only topics", () => {
    const adminTopics = WS_TOPICS.filter((topic) => TOPIC_POLICY[topic] === "admin").sort();
    expect(adminTopics).toEqual(["automations", "logs"]);
  });

  test("the dashboard topics are exactly the three the old routes session-gated", () => {
    const dashboardTopics = WS_TOPICS.filter((topic) => TOPIC_POLICY[topic] === "dashboard").sort();
    expect(dashboardTopics).toEqual(["evcc", "metrics", "statistics"]);
  });

  test("no topic is left without a policy", () => {
    for (const topic of WS_TOPICS) {
      expect(["dashboard", "admin"]).toContain(TOPIC_POLICY[topic]);
    }
  });
});

describe("isWsTopic", () => {
  test("recognises every real topic", () => {
    for (const topic of WS_TOPICS) expect(isWsTopic(topic)).toBe(true);
  });

  test("rejects a name that is not a topic", () => {
    expect(isWsTopic("nonsense")).toBe(false);
    expect(isWsTopic("__ack")).toBe(false);
  });

  test("rejects inherited Object.prototype members", () => {
    // `"constructor" in TOPIC_POLICY` is true. If the check used `in`, the
    // policy lookup would return a function — never `"admin"` — and the topic
    // would read as merely dashboard-gated.
    expect(isWsTopic("constructor")).toBe(false);
    expect(isWsTopic("toString")).toBe(false);
    expect(isWsTopic("hasOwnProperty")).toBe(false);
  });

  test("rejects non-strings", () => {
    expect(isWsTopic(null)).toBe(false);
    expect(isWsTopic(undefined)).toBe(false);
    expect(isWsTopic(7)).toBe(false);
    expect(isWsTopic({ topic: "metrics" })).toBe(false);
  });
});

describe("bufferedWhilePriming", () => {
  test("logs is the one topic that does not buffer during backfill", () => {
    // Its ring-buffer snapshot is synchronous (no window to overtake), and its
    // bus payload is a single entry against the wire's coalesced batch — the
    // one topic where buffering would duplicate rather than order.
    expect(bufferedWhilePriming("logs")).toBe(false);
  });

  test("every awaited-snapshot topic buffers", () => {
    for (const topic of WS_TOPICS.filter((t) => t !== "logs")) {
      expect(bufferedWhilePriming(topic)).toBe(true);
    }
  });
});

describe("wsFrame", () => {
  test("the envelope names the topic in the field the browser narrows on", () => {
    // `LiveBus` reads `frame.topic` to pick the subscriber and silently drops a
    // miss, so the key is the contract — not the shape of the object around it.
    const frame = JSON.parse(wsFrame("evcc", { chargers: [] } as never)) as Record<string, unknown>;
    expect(Object.keys(frame).sort()).toEqual(["data", "topic"]);
    expect(frame.topic).toBe("evcc");
    expect(frame.data).toEqual({ chargers: [] });
  });

  test("every topic envelopes under its own name", () => {
    // One writer for the backfill and one for the fan-out; the envelope has to
    // be the same function for both or a topic paints once and stops.
    for (const topic of WS_TOPICS)
      expect(JSON.parse(wsFrame(topic, null as never)) as Record<string, unknown>).toEqual({
        topic,
        data: null,
      });
  });

  test("carries no namespace prefix", () => {
    // It had `mux:` while the five legacy routes still published bare payloads
    // on the unprefixed names. They are gone; a leftover prefix would publish
    // to a topic nobody subscribes to and deliver nothing, silently.
    for (const topic of WS_TOPICS) {
      expect(JSON.parse(wsFrame(topic, null as never)).topic).toBe(topic);
    }
  });
});
