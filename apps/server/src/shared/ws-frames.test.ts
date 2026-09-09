/**
 * The WebSocket frame union — the wire vocabulary the single multiplexed socket
 * speaks, defined once in `@SunReye/contracts/ws`.
 *
 * Almost everything here is proven by the compiler: the frames are types, they
 * erase at build, and the failure mode they guard against is *drift* — a topic
 * added to the bus but never to the wire, or a payload shape that quietly
 * diverges between the producer and the browser. So this file is deliberately
 * half type assertions (`satisfies`, `@ts-expect-error`) and half a small
 * runtime table that has to be edited by hand when a topic is added: the
 * `satisfies Record<WsTopic, …>` makes forgetting it a compile error, and the
 * runtime assertions state the one asymmetry the table encodes — `logs` is the
 * only topic whose wire payload is an array, because log lines are coalesced at
 * the socket boundary while every other topic publishes one object per emit.
 */

import { describe, expect, test } from "bun:test";
import type { InverterSample } from "@SunReye/inverter-core";
import type { LogEntry } from "@SunReye/contracts/logs";
import type {
  ClientFrame,
  ServerAckFrame,
  ServerFrame,
  WsTopic,
  WsTopicPayloads,
} from "@SunReye/contracts/ws";
import type { StreamTopics } from "./streams";

const entry = (message: string): LogEntry => ({
  time: 0,
  level: "info",
  category: "server",
  message,
});

const sample = (inverterId: string): InverterSample => ({
  time: "2026-08-15T00:00:00.000Z",
  inverterId,
  metrics: {},
});

/**
 * Every topic the socket carries, and whether its wire payload is an array.
 *
 * `satisfies Record<WsTopic, boolean>` is the exhaustiveness gate: a topic
 * added to {@link WsTopicPayloads} without a row here stops compiling, and a
 * row for a topic that does not exist does too.
 */
const WIRE_PAYLOAD_IS_ARRAY = {
  metrics: false,
  plant: false,
  evcc: false,
  statistics: false,
  automations: false,
  logs: true,
} as const satisfies Record<WsTopic, boolean>;

describe("the ws frame union", () => {
  test("the topic table is exhaustive over WsTopic", () => {
    // The type gate is `satisfies` above; this pins the set at runtime so a
    // topic quietly dropped from the union is visible as a failing test rather
    // than a silently smaller table.
    expect(Object.keys(WIRE_PAYLOAD_IS_ARRAY).sort()).toEqual([
      "automations",
      "evcc",
      "logs",
      "metrics",
      "plant",
      "statistics",
    ]);
  });

  test("logs is the only topic whose wire payload is an array", () => {
    const arrayTopics = Object.entries(WIRE_PAYLOAD_IS_ARRAY)
      .filter(([, isArray]) => isArray)
      .map(([topic]) => topic);

    expect(arrayTopics).toEqual(["logs"]);
  });

  test("the logs wire payload is a batch, and a lone entry is not one", () => {
    const batch: WsTopicPayloads["logs"] = [entry("first"), entry("second")];
    expect(batch).toHaveLength(2);

    // @ts-expect-error — the wire coalesces log lines; a single entry is not a frame payload.
    const lone: WsTopicPayloads["logs"] = entry("alone");
    expect(lone).toBeDefined();
  });

  test("the stream bus carries one log entry where the wire carries the batch", () => {
    // The single real divergence between producer and wire, encoded in the
    // types rather than in a comment: `StreamTopics` is derived from
    // `WsTopicPayloads` with exactly this one override.
    const emitted: StreamTopics["logs"] = entry("one line");
    expect(emitted.message).toBe("one line");

    // @ts-expect-error — producers emit a single entry; batching happens at the socket.
    const wrong: StreamTopics["logs"] = [entry("batched too early")];
    expect(wrong).toBeDefined();
  });

  test("every other topic is the same shape on the bus and on the wire", () => {
    const busSample: StreamTopics["metrics"] = sample("deye-1");
    const wireSample: WsTopicPayloads["metrics"] = busSample;
    const backOnTheBus: StreamTopics["metrics"] = wireSample;

    expect(backOnTheBus.inverterId).toBe("deye-1");
  });

  test("a ServerFrame narrows on its topic", () => {
    // This only compiles if `ServerFrame` is a *distributed* union: `data` has
    // to become the logs array once `topic === "logs"`, and the sample
    // otherwise. A `{ topic: WsTopic; data: WsTopicPayloads[WsTopic] }` would
    // fail here.
    const summarise = (frame: ServerFrame): string =>
      frame.topic === "logs" ? `${frame.data.length} lines` : frame.topic;

    const logFrame: ServerFrame = { topic: "logs", data: [entry("a"), entry("b")] };
    const metricsFrame: ServerFrame = { topic: "metrics", data: sample("deye-1") };

    expect(summarise(logFrame)).toBe("2 lines");
    expect(summarise(metricsFrame)).toBe("metrics");
  });

  test("a ServerFrame cannot pair a topic with another topic's payload", () => {
    // @ts-expect-error — metrics carries a sample, never a log batch.
    const mismatched: ServerFrame = { topic: "metrics", data: [entry("nope")] };
    expect(mismatched).toBeDefined();
  });

  test("the ack frame reports what was subscribed and what was denied", () => {
    const ack: ServerAckFrame = {
      topic: "__ack",
      data: { subscribed: ["metrics"], denied: ["logs"] },
    };

    expect(ack.data.subscribed).toEqual(["metrics"]);
    expect(ack.data.denied).toEqual(["logs"]);

    // @ts-expect-error — `__ack` is a control frame, not a topic clients may subscribe to.
    const notATopic: WsTopic = "__ack";
    expect(notATopic).toBeDefined();
  });

  test("a ClientFrame subscribes or unsubscribes to a list of topics", () => {
    const sub: ClientFrame = { t: "sub", topics: ["metrics", "logs"] };
    const unsub: ClientFrame = { t: "unsub", topics: ["logs"] };

    expect(sub.topics).toEqual(["metrics", "logs"]);
    expect(unsub.t).toBe("unsub");

    // @ts-expect-error — the client speaks only `sub` and `unsub`.
    const unknownVerb: ClientFrame = { t: "publish", topics: ["metrics"] };
    expect(unknownVerb).toBeDefined();

    // @ts-expect-error — every requested topic must be a real one.
    const unknownTopic: ClientFrame = { t: "sub", topics: ["nonexistent"] };
    expect(unknownTopic).toBeDefined();
  });
});
