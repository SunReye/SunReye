/**
 * The read-side stream bus: the one typed publish/subscribe seam every live
 * feed (metrics, EVCC, logs, automations, statistics) rides. It is a factory,
 * not a module singleton — each `createStreams()` is an isolated bus, so a test
 * (and the two live instances a dev simulator next to a real server would spin
 * up) never leaks subscriptions into another.
 *
 * The contract proven here: a subscriber is fed every emit until it detaches,
 * many subscribers on one topic are all fed, topics are isolated from each
 * other, and one broken subscriber can neither break the emit nor rob the
 * others of the payload — the guarantee the log fan-out relied on when it was a
 * single module `let` (see the "listener that throws" case that used to live in
 * shared/logging.test.ts).
 */

import { describe, expect, test } from "bun:test";
import type { InverterSample } from "@SunReye/inverter-core";
import { createStreams } from "./streams";
import type { LogEntry } from "@SunReye/contracts/logs";

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

describe("createStreams", () => {
  test("a subscriber is handed each payload emitted on its topic", () => {
    const streams = createStreams();
    const seen: string[] = [];
    streams.subscribe("logs", (e) => seen.push(e.message));

    streams.emit("logs", entry("first"));
    streams.emit("logs", entry("second"));

    expect(seen).toEqual(["first", "second"]);
  });

  test("the exact payload object is delivered, not a copy", () => {
    const streams = createStreams();
    const received: LogEntry[] = [];
    streams.subscribe("logs", (e) => received.push(e));
    const sent = entry("verbatim");

    streams.emit("logs", sent);

    expect(received[0]).toBe(sent);
  });

  test("unsubscribing stops delivery, and only for that subscriber", () => {
    const streams = createStreams();
    const stayed: string[] = [];
    const left: string[] = [];
    streams.subscribe("logs", (e) => stayed.push(e.message));
    const unsubscribe = streams.subscribe("logs", (e) => left.push(e.message));

    streams.emit("logs", entry("before"));
    unsubscribe();
    streams.emit("logs", entry("after"));

    expect(left).toEqual(["before"]);
    expect(stayed).toEqual(["before", "after"]);
  });

  test("unsubscribing twice is harmless", () => {
    const streams = createStreams();
    const seen: string[] = [];
    const unsubscribe = streams.subscribe("logs", (e) => seen.push(e.message));

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();

    streams.emit("logs", entry("dropped"));
    expect(seen).toEqual([]);
  });

  test("every subscriber on a topic is fed, in subscription order", () => {
    const streams = createStreams();
    const order: string[] = [];
    streams.subscribe("logs", () => order.push("a"));
    streams.subscribe("logs", () => order.push("b"));
    streams.subscribe("logs", () => order.push("c"));

    streams.emit("logs", entry("x"));

    expect(order).toEqual(["a", "b", "c"]);
  });

  test("emitting to a topic with no subscribers is a no-op, not a throw", () => {
    const streams = createStreams();
    expect(() => streams.emit("logs", entry("into the void"))).not.toThrow();
  });

  test("topics are isolated — an emit reaches only its own subscribers", () => {
    const streams = createStreams();
    const logs: string[] = [];
    const metrics: string[] = [];
    streams.subscribe("logs", (e) => logs.push(e.message));
    streams.subscribe("metrics", (s) => metrics.push(s.inverterId));

    streams.emit("logs", entry("a log line"));
    streams.emit("metrics", sample("deye-1"));

    expect(logs).toEqual(["a log line"]);
    expect(metrics).toEqual(["deye-1"]);
  });

  test("a subscriber that throws breaks neither the emit nor the other subscribers", () => {
    const streams = createStreams();
    const survivors: string[] = [];
    streams.subscribe("logs", () => {
      throw new Error("broadcast socket closed");
    });
    streams.subscribe("logs", (e) => survivors.push(e.message));

    expect(() => streams.emit("logs", entry("still delivered"))).not.toThrow();
    expect(survivors).toEqual(["still delivered"]);
  });

  test("a subscriber added during an emit is not fed by that same emit", () => {
    const streams = createStreams();
    const late: string[] = [];
    streams.subscribe("logs", () => {
      streams.subscribe("logs", (e) => late.push(e.message));
    });

    streams.emit("logs", entry("first"));
    expect(late).toEqual([]);

    streams.emit("logs", entry("second"));
    expect(late).toEqual(["second"]);
  });

  test("two buses are independent — a subscription on one never sees the other's emits", () => {
    const a = createStreams();
    const b = createStreams();
    const seen: string[] = [];
    a.subscribe("logs", (e) => seen.push(e.message));

    b.emit("logs", entry("on the other bus"));

    expect(seen).toEqual([]);
  });

  test("an unknown topic is a compile error", () => {
    const streams = createStreams();
    // @ts-expect-error — the topic must be a key of StreamTopics.
    streams.emit("nonexistent", entry("nope"));
    // @ts-expect-error — the payload must match the topic's declared shape.
    streams.emit("metrics", entry("wrong payload"));
  });
});
