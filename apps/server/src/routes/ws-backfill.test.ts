/**
 * The subscribe-time snapshot table: which topics have a "current state" worth
 * replaying to a connection that just asked for them, and what each one answers.
 *
 * This table used to be an object literal inside `index.ts`, where no test could
 * reach it — deleting a whole entry, or the `profile` guard, or the table itself
 * left the suite green. Its failures are the quiet kind: a topic with no entry
 * simply sends nothing on subscribe, so the client sits acked and empty until
 * the next live emit (for `statistics`, fifteen seconds; for `evcc`, whenever
 * the car next changes something). Nothing logs, nothing throws.
 *
 * `metrics` being absent is a decision, not an omission, so it is pinned as one.
 */

import { describe, expect, test } from "bun:test";
import type { AutomationStreamMessage } from "@SunReye/contracts/automation";
import type { EvccState } from "@SunReye/contracts/evcc";
import type { LogEntry } from "@SunReye/contracts/logs";
import type { StatisticsTodayMessage } from "@SunReye/contracts/statistics";
import type { InverterProfile } from "@SunReye/inverter-core";
import { type TopicBackfillDeps, createTopicBackfill } from "./ws-backfill";

const profile = { id: "test-profile" } as unknown as InverterProfile;

const evccState = { reachable: true, loadpoints: [], subtractFromHome: false } as EvccState;

const todayMessage = {
  type: "today",
  at: "2026-08-16T12:00:00.000Z",
} as unknown as StatisticsTodayMessage;

const automationMessage = {
  tickMs: 30_000,
  point: null,
  plan: null,
} as unknown as AutomationStreamMessage;

const logLine = (message: string): LogEntry => ({
  time: 1_755_000_000_000,
  level: "info",
  category: "server",
  message,
});

/** The table, built over stand-ins for every producer it reads. */
function table(overrides: Partial<TopicBackfillDeps> = {}) {
  return createTopicBackfill({
    profile,
    evccSnapshot: () => evccState,
    todayStatistics: async () => todayMessage,
    automationStreamSnapshot: async () => automationMessage,
    recentLogs: () => [],
    plantSnapshot: () => null,
    ...overrides,
  });
}

describe("which topics have a subscribe-time snapshot", () => {
  test("the four topics with a current state are present and metrics is not", async () => {
    // `metrics` is deliberately absent: the next sample is a poll interval away
    // and there is no meaningful "current" one to replay. Every other topic has
    // state a fresh subscriber would otherwise have to wait out.
    const backfill = table();

    expect(Object.keys(backfill).sort()).toEqual([
      "automations",
      "evcc",
      "logs",
      "plant",
      "statistics",
    ]);
    expect(Object.hasOwn(backfill, "metrics")).toBe(false);
  });

  test("each present entry is a reader, not a captured value", async () => {
    // Read per subscribe, not once at boot: a connection opened an hour from now
    // must be primed with the state as it is then.
    const backfill = table();

    for (const topic of ["evcc", "statistics", "automations", "logs"] as const)
      expect(typeof backfill[topic]).toBe("function");
  });
});

describe("the evcc entry", () => {
  test("answers the current snapshot", async () => {
    expect(await table().evcc?.()).toBe(evccState);
  });

  test("answers nothing while EVCC has never reported", async () => {
    // `null` before the first MQTT message — the socket sends no snapshot frame
    // rather than a frame saying nothing.
    expect(await table({ evccSnapshot: () => null }).evcc?.()).toBeNull();
  });
});

describe("the statistics entry", () => {
  test("reads today's figures for the active profile", async () => {
    const asked: (InverterProfile | null)[] = [];

    const backfill = table({
      todayStatistics: async (p) => {
        asked.push(p);
        return todayMessage;
      },
    });

    expect(await backfill.statistics?.()).toBe(todayMessage);
    // The profile the table was built with, not some other one it found.
    expect(asked).toEqual([profile]);
  });

  test("answers nothing in onboarding-only boot instead of reading without a profile", async () => {
    // There is no profile to price or aggregate against; calling through would
    // throw inside the query and turn a fresh install's first subscribe into a
    // logged priming failure.
    let called = 0;

    const backfill = table({
      profile: null,
      todayStatistics: async () => {
        called += 1;
        return todayMessage;
      },
    });

    expect(await backfill.statistics?.()).toBeUndefined();
    expect(called).toBe(0);
  });
});

describe("the automations entry", () => {
  test("answers the engine's current stream snapshot", async () => {
    expect(await table().automations?.()).toBe(automationMessage);
  });
});

describe("the logs entry", () => {
  test("answers the ring buffer as the array the wire carries", async () => {
    // `logs` is the one topic whose wire payload is a batch, and the snapshot
    // rides that same shape — a bare entry would be unreadable to the client.
    const backfill = table({ recentLogs: () => [logLine("one"), logLine("two")] });

    const snapshot = await backfill.logs?.();

    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot?.map((entry) => entry.message)).toEqual(["one", "two"]);
  });

  test("answers nothing on an empty ring rather than an empty batch", async () => {
    // An empty array is a frame the client would render as "a burst arrived and
    // it was empty"; nothing at all is the honest answer for a fresh boot.
    expect(await table({ recentLogs: () => [] }).logs?.()).toBeUndefined();
  });
});
