/**
 * THE FOLDS THAT ARE NOT SQL: the raw-tier backfill and the live reading.
 *
 * The rollup tiers fold in the database (`./rollup-sql.ts`'s
 * `plantRollupSeries`) because their rows are already bucketed. Raw samples are
 * not: two inverters polled a second apart never share an instant, so a naive
 * per-bucket sum dips wherever one of them has no sample. Both folds here align
 * each member on the common grid FIRST — last observation carried forward,
 * per member — and only then apply the role's aggregate.
 *
 * Three rules, shared with the SQL fold:
 *  - `sum` adds, `weighted-mean` averages by member weight;
 *  - a `per-device` metric is dropped — there is no plant value for it;
 *  - a member with nothing to say contributes NOTHING, never zero. Before its
 *    first sample, or stale in the live fold, it is simply absent.
 */

import type { PlantSample } from "@SunReye/contracts/ws";
import type { PlantAggregate } from "@SunReye/inverter-core";
import type { RecentBackfill, RecentSeries } from "./history";

export type AggregateOf = (metric: string) => PlantAggregate;

export interface MemberBackfill {
  weight: number;
  backfill: RecentBackfill;
}

interface Contribution {
  value: number;
  weight: number;
}

function fold(kind: Exclude<PlantAggregate, "per-device">, parts: readonly Contribution[]): number {
  if (kind === "sum") return parts.reduce((acc, p) => acc + p.value, 0);
  const weight = parts.reduce((acc, p) => acc + p.weight, 0);
  return parts.reduce((acc, p) => acc + p.value * p.weight, 0) / weight;
}

/** One member's series for a metric as `offset -> value` on the common grid. */
interface MemberPoints {
  weight: number;
  points: Map<number, number>;
}

function memberPoints(m: MemberBackfill, metric: string, shift: number): MemberPoints | null {
  const s = m.backfill.metrics[metric];
  if (!s) return null;
  const points = new Map<number, number>();
  s.o.forEach((o, i) => {
    const v = s.v[i];
    if (v !== undefined && Number.isFinite(v)) points.set(o + shift, v);
  });
  return { weight: m.weight, points };
}

/**
 * Walk the union of every member's offsets in order, carrying each member's
 * last value forward, and fold wherever at least one member has a value.
 */
function foldOnGrid(
  kind: Exclude<PlantAggregate, "per-device">,
  members: readonly MemberPoints[],
): RecentSeries {
  const offsets = [...new Set(members.flatMap((m) => [...m.points.keys()]))].sort((a, b) => a - b);
  const held: Array<number | undefined> = members.map(() => undefined);
  const out: RecentSeries = { o: [], v: [] };
  for (const offset of offsets) {
    const parts: Contribution[] = [];
    members.forEach((m, i) => {
      const v = m.points.get(offset);
      if (v !== undefined) held[i] = v;
      const current = held[i];
      if (current !== undefined) parts.push({ value: current, weight: m.weight });
    });
    if (parts.length === 0) continue;
    out.o.push(offset);
    out.v.push(fold(kind, parts));
  }
  return out;
}

/** Fold every member's compact backfill onto one grid. */
export function foldRecentBackfills(
  members: readonly MemberBackfill[],
  aggregateOf: AggregateOf,
): RecentBackfill {
  const step = members[0]?.backfill.step ?? 1;
  const withData = members.filter((m) => Object.keys(m.backfill.metrics).length > 0);
  if (withData.length === 0) return { t0: 0, step, metrics: {} };
  const t0 = Math.min(...withData.map((m) => m.backfill.t0));
  const stepMs = step * 1000;
  const metricNames = new Set(withData.flatMap((m) => Object.keys(m.backfill.metrics)));

  const metrics: Record<string, RecentSeries> = {};
  for (const metric of metricNames) {
    const kind = aggregateOf(metric);
    if (kind === "per-device") continue;
    const perMember = withData
      .map((m) => memberPoints(m, metric, Math.round((m.backfill.t0 - t0) / stepMs)))
      .filter((m): m is MemberPoints => m !== null);
    const series = foldOnGrid(kind, perMember);
    if (series.o.length > 0) metrics[metric] = series;
  }
  return { t0, step, metrics };
}

export interface LiveMember {
  slug: string;
  weight: number;
  sample: { time: string; metrics: Record<string, number> } | null;
}

/** The plant's live reading, as published on the `plant` topic. */
export type PlantLiveReading = PlantSample;

type FreshMember = LiveMember & { sample: NonNullable<LiveMember["sample"]>; atMs: number };

/** Split the roster into members with a fresh sample and the stale rest. */
function partitionFresh(
  members: readonly LiveMember[],
  nowMs: number,
  staleAfterMs: number,
): { fresh: FreshMember[]; stale: string[] } {
  const fresh: FreshMember[] = [];
  const stale: string[] = [];
  for (const m of members) {
    const atMs = m.sample ? Date.parse(m.sample.time) : Number.NaN;
    const isFresh = m.sample !== null && Number.isFinite(atMs) && nowMs - atMs <= staleAfterMs;
    if (isFresh && m.sample) fresh.push({ ...m, sample: m.sample, atMs });
    else stale.push(m.slug);
  }
  return { fresh, stale };
}

/** Fold one metric across the fresh members, or null when none reports it finitely. */
function foldMetric(
  kind: Exclude<PlantAggregate, "per-device">,
  key: string,
  fresh: readonly FreshMember[],
): number | null {
  const parts: Contribution[] = [];
  for (const m of fresh) {
    const v = m.sample.metrics[key];
    if (v !== undefined && Number.isFinite(v)) parts.push({ value: v, weight: m.weight });
  }
  return parts.length > 0 ? fold(kind, parts) : null;
}

export function foldLiveSamples(
  members: readonly LiveMember[],
  opts: { nowMs: number; staleAfterMs: number; aggregateOf: AggregateOf },
): PlantLiveReading {
  const { fresh, stale } = partitionFresh(members, opts.nowMs, opts.staleAfterMs);
  const keys = new Set(fresh.flatMap((m) => Object.keys(m.sample.metrics)));
  const metrics: Record<string, number> = {};
  for (const key of keys) {
    const kind = opts.aggregateOf(key);
    if (kind === "per-device") continue;
    const value = foldMetric(kind, key, fresh);
    if (value !== null) metrics[key] = value;
  }
  const newest = fresh.reduce((acc, m) => Math.max(acc, m.atMs), Number.NEGATIVE_INFINITY);
  return {
    time: new Date(Number.isFinite(newest) ? newest : opts.nowMs).toISOString(),
    metrics,
    members: members.map((m) => m.slug),
    stale,
  };
}
