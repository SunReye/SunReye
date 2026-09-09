/**
 * The subscribe-time snapshot table: what each topic replays to a connection
 * that just asked for it.
 *
 * These are the on-open sends of the five retired `/ws/*` routes, one table row
 * apiece. They live here rather than inline in `index.ts` for the same reason
 * {@link ./ws-publish} does: nothing in `index.ts` is reachable from a test, and
 * a missing or wrong row fails *silently* — the socket opens, the `sub` is
 * acked, and the client simply waits for a live emit that is fifteen seconds
 * (statistics) or a car's next state change (evcc) away. There is no error to
 * notice.
 *
 * `metrics` has no row on purpose: its next sample is a poll interval away and
 * there is no meaningful "current" one to replay. Absence is the decision, so
 * {@link ./ws-backfill.test} pins it as one.
 *
 * Every producer is injected rather than imported, so the table can be built
 * over stand-ins — and so `index.ts` composes it instead of deciding it.
 */

import type { AutomationStreamMessage } from "@SunReye/contracts/automation";
import type { EvccState } from "@SunReye/contracts/evcc";
import type { LogEntry } from "@SunReye/contracts/logs";
import type { StatisticsTodayMessage } from "@SunReye/contracts/statistics";
import type { PlantSample } from "@SunReye/contracts/ws";
import type { InverterProfile } from "@SunReye/inverter-core";
import type { TopicBackfill } from "./ws-connection";

export interface TopicBackfillDeps {
  /** Active inverter profile — `null` in onboarding-only boot. */
  profile: InverterProfile | null;
  /** Current EVCC state, or `null` before its first MQTT message. */
  evccSnapshot: () => EvccState | null;
  /** Today's cost + energy picture for the active profile. */
  todayStatistics: (profile: InverterProfile) => Promise<StatisticsTodayMessage>;
  /** The automation engine's current stream snapshot (status, history, plan). */
  automationStreamSnapshot: () => Promise<AutomationStreamMessage>;
  /** The in-memory log ring buffer. */
  recentLogs: () => LogEntry[];
  /** The plant's last folded reading, or `null` before the first sample. */
  plantSnapshot: () => PlantSample | null;
}

/** Build the per-topic snapshot readers the `/ws` priming step calls. */
export function createTopicBackfill(deps: TopicBackfillDeps): TopicBackfill {
  return {
    evcc: () => deps.evccSnapshot(),
    // Unlike `metrics`, the plant reading is worth replaying: it is the fold of
    // several devices' last samples, and the next one is a poll away for the
    // device that polls slowest.
    plant: () => deps.plantSnapshot(),
    // Onboarding-only boot has nothing to price or aggregate against, so the
    // topic primes empty rather than reading through and throwing inside the
    // query — a fresh install's first subscribe is not a priming failure.
    statistics: () => (deps.profile ? deps.todayStatistics(deps.profile) : undefined),
    automations: () => deps.automationStreamSnapshot(),
    logs: () => {
      // An empty ring is "nothing to replay", not a burst that happened to carry
      // no lines — the wire payload here is the batch itself.
      const recent = deps.recentLogs();
      return recent.length > 0 ? recent : undefined;
    },
  };
}
