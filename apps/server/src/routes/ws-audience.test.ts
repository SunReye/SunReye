/**
 * "Is anyone actually watching": the two topics whose producers do the expensive
 * work only for a live audience, and the statistics republish that rides one of
 * them.
 *
 * The audience is counted on the server's pub/sub, under the topic name itself —
 * the same string {@link ./ws-publish} publishes on and {@link ./ws-connection}
 * joins. A name that is wrong but still a real topic type-checks (`satisfies
 * WsTopic` catches a typo, not a mix-up) and reads as a permanently idle
 * instance: the engine never broadcasts a tick, statistics never republish, and
 * nothing anywhere says why. So the tests pin the string each predicate actually
 * asks about, not merely that it asks.
 */

import { describe, expect, test } from "bun:test";
import type { StatisticsTodayMessage } from "@SunReye/contracts/statistics";
import type { InverterProfile } from "@SunReye/inverter-core";
import { createStreams } from "../shared/streams";
import { createTopicAudience, publishTodayStatistics } from "./ws-audience";

const profile = { id: "test-profile" } as unknown as InverterProfile;

const todayMessage = {
  type: "today",
  at: "2026-08-16T12:00:00.000Z",
} as unknown as StatisticsTodayMessage;

/**
 * A stand-in for Bun's pub/sub that records every topic it was asked about, plus
 * the pre-`.listen()` window in which there is no server at all.
 */
function audienceHarness(counts: Record<string, number> = {}) {
  const asked: string[] = [];
  let listening = true;
  const audience = createTopicAudience({
    server: () =>
      listening
        ? {
            subscriberCount: (topic: string) => {
              asked.push(topic);
              return counts[topic] ?? 0;
            },
          }
        : undefined,
  });
  return { audience, asked, setListening: (next: boolean) => (listening = next) };
}

describe("the topic each audience predicate counts", () => {
  test("the automations predicate counts the automations topic", () => {
    const h = audienceHarness();

    h.audience.automations();

    expect(h.asked).toEqual(["automations"]);
  });

  test("the statistics predicate counts the statistics topic", () => {
    const h = audienceHarness();

    h.audience.statistics();

    expect(h.asked).toEqual(["statistics"]);
  });
});

describe("what the count means", () => {
  test("no subscriber on the topic is no audience", () => {
    const h = audienceHarness({ statistics: 0, automations: 0 });

    expect(h.audience.statistics()).toBe(false);
    expect(h.audience.automations()).toBe(false);
  });

  test("one subscriber on the topic is an audience", () => {
    const h = audienceHarness({ statistics: 1, automations: 3 });

    expect(h.audience.statistics()).toBe(true);
    expect(h.audience.automations()).toBe(true);
  });

  test("a count is taken per call, never captured at boot", () => {
    // A page opened an hour from now must start receiving frames on the very
    // next tick, so the predicate re-reads the server rather than the answer.
    const counts: Record<string, number> = { automations: 0 };
    const audience = createTopicAudience({
      server: () => ({ subscriberCount: (topic: string) => counts[topic] ?? 0 }),
    });

    expect(audience.automations()).toBe(false);
    counts.automations = 1;
    expect(audience.automations()).toBe(true);
  });

  test("before the server is listening there is no audience and no throw", () => {
    // The predicates are handed to the producers before `.listen()` resolves.
    const h = audienceHarness({ statistics: 5 });
    h.setListening(false);

    expect(h.audience.statistics()).toBe(false);
  });
});

/** The republish, over a real bus and a recording snapshot reader. */
function publishHarness(
  options: {
    watched?: boolean;
    profile?: InverterProfile | null;
    today?: () => Promise<StatisticsTodayMessage>;
  } = {},
) {
  const emitted: unknown[] = [];
  const streams = createStreams();
  streams.subscribe("statistics", (message) => emitted.push(message));
  let reads = 0;
  return {
    emitted,
    reads: () => reads,
    run: () =>
      publishTodayStatistics({
        profile: options.profile === undefined ? profile : options.profile,
        watched: () => options.watched ?? true,
        streams,
        todayStatistics: async (p) => {
          reads += 1;
          return (await options.today?.()) ?? { ...todayMessage, at: p.id };
        },
      }),
  };
}

describe("the statistics republish", () => {
  test("publishes today's figures on the statistics topic while it is watched", async () => {
    const h = publishHarness({ watched: true });

    await h.run();

    expect(h.emitted).toEqual([{ ...todayMessage, at: profile.id }]);
  });

  test("does no work at all with nobody watching", async () => {
    // The whole point of the gate: an idle instance pays nothing for the
    // feature, so the snapshot query must not even run.
    const h = publishHarness({ watched: false });

    await h.run();

    expect(h.reads()).toBe(0);
    expect(h.emitted).toEqual([]);
  });

  test("does nothing in onboarding-only boot", async () => {
    const h = publishHarness({ profile: null });

    await h.run();

    expect(h.reads()).toBe(0);
    expect(h.emitted).toEqual([]);
  });

  test("a failed snapshot is swallowed so the interval keeps ticking", async () => {
    // This runs on a `setInterval`; a rejection escaping here is an unhandled
    // rejection every fifteen seconds for the life of the process.
    const h = publishHarness({
      today: () => Promise.reject(new Error("rollup query failed")),
    });

    await h.run();

    expect(h.emitted).toEqual([]);
  });
});
