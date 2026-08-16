/**
 * "Is anyone actually watching": the two topics whose producers skip their work
 * when no `/ws` connection holds them, and the statistics republish gated on
 * one of them.
 *
 * The audience is counted on the server's pub/sub under the topic name itself —
 * the same string {@link ./ws-publish} publishes on and {@link ./ws-connection}
 * joins. Typing the names (`satisfies WsTopic`) catches a typo but not a mix-up:
 * counting `metrics` instead of `automations` compiles, and the result is an
 * instance that looks permanently idle — the engine never broadcasts a tick,
 * statistics never republish, nothing logs. The names therefore live where
 * {@link ./ws-audience.test} can pin the string each predicate asks about,
 * rather than inline in `index.ts` where nothing could reach them.
 */

import type { StatisticsTodayMessage } from "@SunReye/contracts/statistics";
import type { WsTopic } from "@SunReye/contracts/ws";
import type { InverterProfile } from "@SunReye/inverter-core";
import { log } from "../shared/logging";
import type { Streams } from "../shared/streams";

const audienceLog = log("ws");

/** The audience surface of the running server — Bun's pub/sub, structurally. */
export interface TopicAudience {
  subscriberCount(topic: string): number;
}

export interface TopicAudienceDeps {
  /**
   * The live server, re-read per call. `app.server` does not exist until
   * `.listen()` resolves, and the predicates are handed to the producers before
   * that — no server is no audience.
   */
  server: () => TopicAudience | undefined;
}

/** Whether each audience-gated topic currently has a listener. */
export interface WatchedTopics {
  /** Gates the engine's per-tick broadcast and the plan projection built for it. */
  automations(): boolean;
  /** Gates the statistics republish below. */
  statistics(): boolean;
}

/**
 * Audience predicates for the two gated topics.
 *
 * Read per call, never captured: a page opened an hour from now must start
 * receiving frames on the very next tick.
 */
export function createTopicAudience(deps: TopicAudienceDeps): WatchedTopics {
  // One fan-out, one count: `/ws` subscribers join the bare topic name.
  const watched = (topic: WsTopic) => (deps.server()?.subscriberCount(topic) ?? 0) > 0;
  return {
    automations: () => watched("automations"),
    statistics: () => watched("statistics"),
  };
}

export interface StatisticsPublishDeps {
  /** Active inverter profile — `null` in onboarding-only boot. */
  profile: InverterProfile | null;
  /** Whether the `statistics` topic has a listener right now. */
  watched: () => boolean;
  /** The read-side bus the socket fan-out subscribes to. */
  streams: Streams;
  /** Today's cost + energy picture for the active profile. */
  todayStatistics: (profile: InverterProfile) => Promise<StatisticsTodayMessage>;
}

/**
 * Republish today's figures once, if there is anyone to republish them to.
 *
 * Driven by a slow interval (and by the runtime whenever a price sync stores
 * fresh slots). Resolves rather than rejects on a failed read: this runs on a
 * timer, so an escaping rejection would be an unhandled one every tick.
 */
export async function publishTodayStatistics(deps: StatisticsPublishDeps): Promise<void> {
  if (!deps.profile || !deps.watched()) return;
  try {
    deps.streams.emit("statistics", await deps.todayStatistics(deps.profile));
  } catch (error) {
    audienceLog.warn("statistics publish failed: {error}", { error });
  }
}
