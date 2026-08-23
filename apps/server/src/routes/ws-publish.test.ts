/**
 * The socket fan-out: bus emit → one enveloped frame on the topic's pub/sub name.
 *
 * This is the publishing half of a pair that has to agree on a string. The
 * connection state machine joins `ws.subscribe(topic)` (pinned in
 * ./ws-connection.test.ts) and this module publishes to `server.publish(topic)`;
 * if the two names ever drift the socket stays open, acks every subscribe, and
 * delivers nothing — no error anywhere. That silence is why the names are pinned
 * on both sides rather than grepped, and why the fan-out was lifted out of
 * `index.ts` (where nothing could reach it) in the first place.
 *
 * The other load-bearing part is `logs`: it is the one topic whose bus payload
 * (a single entry) differs from its wire payload (a coalesced batch), and this
 * flush is the only place that conversion happens.
 */

import { describe, expect, test } from "bun:test";
import type { LogEntry } from "@SunReye/contracts/logs";
import type { WsTopicPayloads } from "@SunReye/contracts/ws";
import type { InverterSample } from "@SunReye/inverter-core";
import { createStreams } from "../shared/streams";
import { type TopicPublisher, publishLiveTopics } from "./ws-publish";
import { TOPIC_POLICY } from "./ws-topics";

/** How long the tests let a coalescing window run for. */
const FLUSH_MS = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sample: InverterSample = {
  time: "2026-08-16T12:00:00.000Z",
  inverterId: "test-profile",
  metrics: { "pv.power": 4200 },
};

const logLine = (message: string): LogEntry => ({
  time: 1_755_000_000_000,
  level: "info",
  category: "server",
  message,
});

/**
 * A recording stand-in for Bun's publish surface, plus a switch for the window
 * before `.listen()` resolves — `app.server` is undefined until then, and the
 * bus is already wired.
 */
function harness(options: { listening?: boolean; leadDeviceId?: string | null } = {}) {
  const published: { topic: string; message: string }[] = [];
  let listening = options.listening ?? true;
  const publisher: TopicPublisher = {
    publish: (topic: string, message: string) => published.push({ topic, message }),
  };
  const streams = createStreams();
  publishLiveTopics({
    streams,
    publisher: () => (listening ? publisher : undefined),
    logFlushMs: FLUSH_MS,
    leadDeviceId: options.leadDeviceId === undefined ? sample.inverterId : options.leadDeviceId,
  });
  return {
    streams,
    published,
    setListening: (next: boolean) => (listening = next),
    /** Every publish, decoded back into the frame the browser would parse. */
    frames: () =>
      published.map((entry) => ({
        topic: entry.topic,
        frame: JSON.parse(entry.message) as { topic: string; data: unknown },
      })),
  };
}

describe("the pub/sub name each topic fans out on", () => {
  test("every live topic publishes on its own bare topic name", async () => {
    // The names are the wire topics themselves — no prefix, no namespace. The
    // `mux:` prefix that used to be here existed only to keep this fan-out off
    // the five legacy routes' topics while both shipped; those routes are gone,
    // and a leftover prefix would silently deliver nothing to `/ws`.
    const h = harness();

    h.streams.emit("metrics", sample);
    h.streams.emit("evcc", { loadpoints: [] } as unknown as WsTopicPayloads["evcc"]);
    h.streams.emit("statistics", { type: "prices" });
    h.streams.emit("automations", { tickMs: 30_000 } as unknown as WsTopicPayloads["automations"]);
    h.streams.emit("logs", logLine("boot"));
    await sleep(FLUSH_MS * 3);

    // Compared against the POLICY table rather than a literal list: a topic
    // added to `TOPIC_POLICY` with no `streams.subscribe` here would otherwise
    // pass, and in production that card paints its backfill once and then goes
    // silent forever — a missing wire, which no contract test can see.
    // `metrics` also goes out on its device channel (`metrics:<id>`); the bare
    // names are what this test is about, so the qualified one is set aside.
    const bare = h.published.map((entry) => entry.topic).filter((t) => !t.includes(":"));
    expect(bare.sort()).toEqual(Object.keys(TOPIC_POLICY).sort());
  });

  test("the pub/sub name matches the topic the frame is tagged with", async () => {
    // The two halves of one frame: publishing on `x` a frame tagged `y` would
    // deliver to the right sockets and be dropped by every client's `switch`.
    const h = harness();

    h.streams.emit("metrics", sample);
    h.streams.emit("statistics", { type: "prices" });
    h.streams.emit("logs", logLine("boot"));
    await sleep(FLUSH_MS * 3);

    // A device channel is `<topic>:<device>`, and the frame stays tagged with
    // the topic — that is what the browser narrows on.
    for (const { topic, frame } of h.frames())
      expect(`${frame.topic}`).toBe(topic.replace(/:.*$/, ""));
  });
});

describe("the frame envelope", () => {
  test("a sample is published as the tagged envelope, not as the bare payload", () => {
    // The bare-payload shape is what the retired `/ws/metrics` sent. The
    // multiplexed client narrows on `topic`, so an untagged payload is an
    // unparseable frame to it.
    const h = harness();

    h.streams.emit("metrics", sample);

    expect(h.frames()).toEqual([
      { topic: "metrics", frame: { topic: "metrics", data: sample } },
      { topic: `metrics:${sample.inverterId}`, frame: { topic: "metrics", data: sample } },
    ]);
  });

  test("a statistics signal keeps its own union member intact", () => {
    const h = harness();

    h.streams.emit("statistics", { type: "prices" });

    expect(h.frames()[0]?.frame).toEqual({ topic: "statistics", data: { type: "prices" } });
  });
});

describe("log coalescing", () => {
  test("a burst becomes one frame carrying the batch as an array", async () => {
    // Startup and error storms emit many lines at once; the wire contract for
    // `logs` is an array precisely because of this flush.
    const h = harness();

    h.streams.emit("logs", logLine("one"));
    h.streams.emit("logs", logLine("two"));
    h.streams.emit("logs", logLine("three"));
    await sleep(FLUSH_MS * 3);

    expect(h.published).toHaveLength(1);
    expect(h.frames().map(({ frame }) => frame.topic)).toEqual(["logs"]);
    expect(
      h.frames().map(({ frame }) => (frame.data as LogEntry[]).map((entry) => entry.message)),
    ).toEqual([["one", "two", "three"]]);
  });

  test("a later line opens a fresh window instead of resending the closed one", async () => {
    // The flush drains the queue. Left undrained, the next window would resend
    // every line the viewer already has.
    const h = harness();

    h.streams.emit("logs", logLine("first"));
    await sleep(FLUSH_MS * 3);
    h.streams.emit("logs", logLine("second"));
    await sleep(FLUSH_MS * 3);

    expect(h.published).toHaveLength(2);
    expect(
      h.frames().map(({ frame }) => (frame.data as LogEntry[]).map((entry) => entry.message)),
    ).toEqual([["first"], ["second"]]);
  });
});

describe("before the server is listening", () => {
  test("an emit is dropped rather than thrown, and the next one still publishes", async () => {
    // The bus is wired while `app.server` is still undefined (the subscriptions
    // are registered before `.listen()` resolves), and a boot-time log line can
    // already be emitted in that window.
    const h = harness({ listening: false });

    h.streams.emit("metrics", sample);
    h.streams.emit("logs", logLine("boot"));
    await sleep(FLUSH_MS * 3);
    expect(h.published).toEqual([]);

    h.setListening(true);
    h.streams.emit("metrics", sample);
    expect(h.published.map((entry) => entry.topic)).toEqual([
      "metrics",
      `metrics:${sample.inverterId}`,
    ]);
  });
});

// A plant can hold several devices. Every reading is published on its own
// device's channel, so a client can ask for one machine — and the lead device's
// also goes out on the bare `metrics` name, which is what every existing client
// subscribes to and must keep receiving unchanged.
describe("metrics per device", () => {
  const from = (inverterId: string): InverterSample => ({ ...sample, inverterId });

  test("the lead device publishes on both the bare topic and its own channel", async () => {
    const h = harness({ leadDeviceId: "roof" });

    h.streams.emit("metrics", from("roof"));

    expect(h.published.map((e) => e.topic)).toEqual(["metrics", "metrics:roof"]);
  });

  test("another device publishes only on its own channel", async () => {
    // The bare name is the lead device's. A second device publishing there too
    // would have every existing client alternating between two machines, each
    // frame stamped with the current time — plausible, and wrong.
    const h = harness({ leadDeviceId: "roof" });

    h.streams.emit("metrics", from("barn"));

    expect(h.published.map((e) => e.topic)).toEqual(["metrics:barn"]);
  });

  test("both devices' frames carry their own sample", async () => {
    const h = harness({ leadDeviceId: "roof" });

    h.streams.emit("metrics", from("roof"));
    h.streams.emit("metrics", from("barn"));

    const byTopic = new Map(h.published.map((e) => [e.topic, JSON.parse(e.message)]));
    expect(byTopic.get("metrics:roof").data.inverterId).toBe("roof");
    expect(byTopic.get("metrics:barn").data.inverterId).toBe("barn");
    expect(byTopic.get("metrics").data.inverterId).toBe("roof");
  });

  test("with no lead named, every device gets the bare topic too", async () => {
    // The onboarding boot, and every install before devices existed: one
    // device, and the client that asks for plain `metrics` must still be fed.
    const h = harness({ leadDeviceId: null });

    h.streams.emit("metrics", from("only"));

    expect(h.published.map((e) => e.topic)).toEqual(["metrics", "metrics:only"]);
  });

  test("a non-lead device whose id cannot be a channel is not published live at all", async () => {
    // Ids are slugs in practice; a hand-edited row could hold anything.
    // `channelFor` refuses it, and the fallback is the *bare* topic — which is
    // the lead device's. Publishing there would put a second machine's readings
    // on every existing client's feed, so this device stays off the live wire.
    // Its readings still reach history and MQTT, which are keyed by id.
    const h = harness({ leadDeviceId: "roof" });

    h.streams.emit("metrics", from("not a slug"));

    expect(h.published.map((e) => e.topic)).toEqual([]);
  });
});
