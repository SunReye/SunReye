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
import { TOPIC_POLICY, bufferedWhilePriming, isWsTopic, muxFrame, muxTopic } from "./ws-topics";

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

describe("muxTopic", () => {
  test("the multiplexed fan-out lives in its own namespace", () => {
    // The five original routes still publish bare payloads on the unprefixed
    // names; the prefix is what lets both run side by side during migration.
    expect(muxTopic("metrics")).toBe("mux:metrics");
    expect(muxTopic("logs")).toBe("mux:logs");
  });

  test("no mux topic collides with a bare topic name", () => {
    const mux = new Set(WS_TOPICS.map(muxTopic));
    for (const topic of WS_TOPICS) expect(mux.has(topic)).toBe(false);
  });
});

describe("muxFrame", () => {
  test("the envelope names the topic in the field the browser narrows on", () => {
    // `LiveBus` reads `frame.topic` to pick the subscriber and silently drops a
    // miss, so the key is the contract — not the shape of the object around it.
    const frame = JSON.parse(muxFrame("evcc", { chargers: [] } as never)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(frame).sort()).toEqual(["data", "topic"]);
    expect(frame.topic).toBe("evcc");
    expect(frame.data).toEqual({ chargers: [] });
  });

  test("every topic envelopes under its own name", () => {
    // One writer for the backfill and one for the bus republish; the envelope
    // has to be the same function for both or a topic paints once and stops.
    for (const topic of WS_TOPICS)
      expect(JSON.parse(muxFrame(topic, null as never)) as Record<string, unknown>).toEqual({
        topic,
        data: null,
      });
  });
});

/** `index.ts` boots the world at import, so the fan-out is read, not run. */
const indexSource = await Bun.file(new URL("../index.ts", import.meta.url)).text();

describe("every topic is actually wired to the bus fan-out", () => {
  // The envelope has one writer and is well covered. The REGISTRATION does not:
  // deleting `streams.subscribe("evcc", … muxFrame …)` from index.ts leaves the
  // whole suite green, and in production the EV card paints its backfill once
  // and then goes silent forever. A missing wire is not a contract
  // disagreement, so nothing that checks the contract can see it.
  //
  // Matched at the PUBLISH site rather than at `streams.subscribe`, because
  // `logs` does not republish from its subscription: its entries go through the
  // 250 ms batching decorator and are published from the flush. Both shapes end
  // at the same call, so that is where the wire actually is.
  //
  // It compares the SET, so a topic added to `TOPIC_POLICY` without a republish
  // fails here too — not only a deleted one.
  const republished = new Set(
    [...indexSource.matchAll(/publish\(\s*muxTopic\(\s*"(\w+)"/g)].map((match) => match[1]),
  );

  test("each policy topic republishes an enveloped frame", () => {
    expect([...republished].sort()).toEqual([...WS_TOPICS].sort());
  });
});
