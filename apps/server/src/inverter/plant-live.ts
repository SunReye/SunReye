/**
 * The `plant` live topic: every member's latest `metrics` sample, folded by the
 * role's aggregate on each new sample (`../shared/plant-fold.ts`).
 *
 * The member set is re-read lazily, at most once per {@link MEMBERS_TTL_MS}, so
 * a device retired or added in settings reaches the fold within seconds without
 * a select per poll. A retired member's last sample is dropped with it: the live
 * set is the ACTIVE devices (`plantMembers(rows, { live: true })`).
 *
 * The stale rule is the poll cadence's: a member whose last sample is older than
 * {@link STALE_AFTER_MS} is excluded and named in `stale`, never summed as zero
 * — "the device stopped answering" and "the device reads 0 W" must stay two
 * different things (see `../shared/history.ts` on the same five minutes).
 */

import type { PlantSample } from "@SunReye/contracts/ws";
import type { InverterSample } from "@SunReye/inverter-core";
import { type AggregateOf, foldLiveSamples } from "../shared/plant-fold";
import type { PlantMember } from "../shared/plant-source";
import type { Streams } from "../shared/streams";

const STALE_AFTER_MS = 5 * 60 * 1000;
const MEMBERS_TTL_MS = 10 * 1000;

export interface PlantLiveDeps {
  streams: Streams;
  /** The plant's live member set — active devices, with weights. */
  members: () => Promise<readonly PlantMember[]>;
  aggregateOf: AggregateOf;
  now?: () => number;
  staleAfterMs?: number;
  membersTtlMs?: number;
}

export interface PlantLive {
  /** The last reading published, for the subscribe-time backfill. */
  snapshot(): PlantSample | null;
  /** Detach from the bus. */
  stop(): void;
}

export function startPlantLive(deps: PlantLiveDeps): PlantLive {
  const now = deps.now ?? Date.now;
  const staleAfterMs = deps.staleAfterMs ?? STALE_AFTER_MS;
  const ttl = deps.membersTtlMs ?? MEMBERS_TTL_MS;
  const latest = new Map<string, InverterSample>();
  let members: readonly PlantMember[] = [];
  let membersReadAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<void> | null = null;
  let last: PlantSample | null = null;

  const refreshMembers = (): Promise<void> => {
    if (now() - membersReadAt < ttl) return Promise.resolve();
    pending ??= deps
      .members()
      .then((m) => {
        members = m;
        membersReadAt = now();
      })
      // A failed read keeps the last good set; the next sample retries.
      .catch(() => undefined)
      .finally(() => {
        pending = null;
      });
    return pending;
  };

  const fold = (): void => {
    const nowMs = now();
    last = foldLiveSamples(
      members.map((m) => ({ slug: m.slug, weight: m.weight, sample: latest.get(m.slug) ?? null })),
      { nowMs, staleAfterMs, aggregateOf: deps.aggregateOf },
    );
    deps.streams.emit("plant", last);
  };

  const unsubscribe = deps.streams.subscribe("metrics", (sample) => {
    latest.set(sample.inverterId, sample);
    void refreshMembers().then(fold);
  });

  return {
    snapshot: () => last,
    stop: unsubscribe,
  };
}
