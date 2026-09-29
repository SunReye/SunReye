/**
 * WHERE a read is from, resolved once for every stored-data route: the named
 * source, else the primary device. Built over injected collaborators (the
 * roster's primary, the plant's members, the manifest) so the rules are tested
 * here rather than only reachable through a booted server.
 */

import type { ManifestMetric } from "@SunReye/inverter-core";
import type { AggregateOf } from "./plant-fold";
import { aggregateOfMetric, plantFoldFor, targetOf } from "./plant-read";
import {
  type PlantMember,
  type SeriesSourceRequest,
  type SeriesTarget,
  parseSeriesSource,
} from "./plant-source";

/** The two query spellings a request names its source with. */
export type SourceQuery = { source?: string; inverterId?: string };

export interface SourceResolutionDeps {
  /** The roster's primary device slug, re-read per call; `null` before any device exists. */
  primarySlug: () => string | null;
  /** The plant's history members (retired devices included). */
  members: () => Promise<readonly PlantMember[]>;
  /** The active manifest's metrics by key — the roles the plant fold aggregates by. */
  metaByKey: ReadonlyMap<string, ManifestMetric>;
}

export interface SourceResolution {
  /** The device a read means when the request names none, or `null`. */
  defaultSourceId: () => string | null;
  /** WHERE a read is from, or `null` before any device exists. */
  sourceRequest: (q: SourceQuery) => SeriesSourceRequest | null;
  /** The energy readers' target for a request. */
  energyTarget: (q: SourceQuery) => Promise<SeriesTarget | string | undefined>;
  /** The metric readers' arguments for a request, or the plant-level refusal. */
  metricReadArgs: (
    req: SeriesSourceRequest,
    metric: string,
  ) => Promise<ReturnType<typeof plantFoldFor>>;
  /** The role-derived aggregate of a metric key. */
  aggregateOf: AggregateOf;
}

export function createSourceResolution(deps: SourceResolutionDeps): SourceResolution {
  /**
   * The registry's primary inverter, by `devices.slug` — the id every row is
   * written under. It used to be `profile.id`, which worked only because both
   * resolvers carry a transitional `profile_id` arm; a plant with two inverters
   * has no answer in that spelling at all.
   */
  const defaultSourceId = deps.primarySlug;

  /**
   * `source=plant`, `source=<slug>`, the `inverterId` alias, or — nothing named —
   * the primary device, which is what every request meant before the plant had a
   * spelling (#202). A single-device plant reads the same either way; the web
   * chooses `plant` when there is more than one member.
   */
  const sourceRequest = (q: SourceQuery): SeriesSourceRequest | null => {
    const named = parseSeriesSource(q);
    if (named) return named;
    const slug = defaultSourceId();
    return slug ? { kind: "device", slug } : null;
  };

  const membersFor = async (req: SeriesSourceRequest) =>
    req.kind === "plant" ? await deps.members() : [];

  /**
   * Nothing named → the primary device by SLUG, which is also what the live
   * sample is stamped with, so the live `*.today` override keeps matching; the
   * profile-id default is only the fallback of an install with no device row yet.
   */
  const energyTarget = async (q: SourceQuery) => {
    const req = sourceRequest(q);
    if (!req) return q.inverterId;
    return targetOf(req, await membersFor(req));
  };

  const aggregateOf = aggregateOfMetric(deps.metaByKey);

  const metricReadArgs = async (req: SeriesSourceRequest, metric: string) =>
    plantFoldFor(req, await membersFor(req), metric, aggregateOf);

  return { defaultSourceId, sourceRequest, energyTarget, metricReadArgs, aggregateOf };
}
