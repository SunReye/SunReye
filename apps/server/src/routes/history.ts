/**
 * The dashboard's stored-data reads: raw history, the live-buffer backfill,
 * chart rollups, and the cost / energy series. Session-gated like every other
 * dashboard read. Where a read is FROM (`source=plant`, a slug, the primary
 * device) is resolved by index.ts and handed in as {@link HistoryRoutesDeps}.
 */

import { db } from "@SunReye/db";
import { metricsRaw } from "@SunReye/db/schema/metrics";
import { devices, metricKeys } from "@SunReye/db/schema/plants";
import type { InverterProfile } from "@SunReye/inverter-core";
import { and, desc, eq, getTableName, gte } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { computeCost, computeCostSeries, resolveRange } from "../energy/cost";
import { energySeries } from "../energy/energy";
import type { CostBucket } from "../energy/period-keys";
import { queryRecentBuckets, queryRollup } from "../shared/history";
import type { HistoryTier } from "../shared/history-horizon";
import { refuseIncompleteRange } from "../shared/history-horizon-live";
import { getPlantTimeZone } from "../settings/display-settings";
import { deviceScope, metricIdOf } from "../shared/identity-sql";
import type { AggregateOf } from "../shared/plant-fold";
import { type plantFoldFor, isRefusal, targetOf } from "../shared/plant-read";
import {
  type SeriesSourceRequest,
  type SeriesTarget,
  parseSeriesSource,
} from "../shared/plant-source";
import { adminGuard } from "./admin-guard";
import { historyMembers } from "./sources";

const ONBOARDING_REQUIRED = { error: "No active inverter profile — onboarding required" } as const;

type SourceQuery = { source?: string; inverterId?: string };

export interface HistoryRoutesDeps {
  /** Active inverter profile — `null` in onboarding-only boot (the cost reads 503). */
  profile: InverterProfile | null;
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

// Shared query for the per-period series endpoints (cost + energy): an explicit
// [from, to) window at a chosen bucket, plus an optional inverter override.
const seriesQuery = t.Object({
  from: t.String(),
  to: t.String(),
  bucket: t.Union([t.Literal("hour"), t.Literal("day"), t.Literal("month")]),
  source: t.Optional(t.String()),
  inverterId: t.Optional(t.String()),
});

/** Default span of a rollup read without an explicit window, hours (one week). */
const ROLLUP_DEFAULT_HOURS = 168;

/**
 * The window a history read covers: an explicit `[from, to)` when the custom
 * date-range picker sent both bounds (a range ending in the past can't be
 * expressed as an hours-ago offset), else the open-ended hours-ago offset.
 */
function historyWindow(q: { from?: string; to?: string; hours?: number }) {
  if (q.from && q.to) return { from: new Date(q.from), to: new Date(q.to) };
  return { since: new Date(Date.now() - (q.hours ?? ROLLUP_DEFAULT_HOURS) * 60 * 60 * 1000) };
}

/**
 * The tier a `bucket` query parameter reads. `month` is derived from the daily
 * tier, so it inherits the daily horizon.
 */
const TIER_OF: Record<string, HistoryTier> = {
  minute: "minute",
  hour: "hour",
  day: "day",
  month: "day",
};

/**
 * Refuse a range this instance cannot answer COMPLETELY, or `undefined`.
 *
 * Applied to every range-taking read. The hazard is not the empty answer, it is
 * the PARTIAL one: a month-to-date figure whose window opens before the
 * retention horizon — or before a pending 1.2.0 migration's cutover — is a real
 * number computed over a fraction of the range it claims, rendered exactly like a
 * complete one. See `../shared/history-horizon.ts`; issue #154 is the same defect
 * with a different cause, and both are decided there.
 *
 * `422`, not `404` or `503`: the request is well-formed and the instance is
 * healthy — the RANGE is unanswerable, and the body carries the oldest instant
 * that is not, so a client can offer to clamp to it.
 */
async function guardRange(
  tier: HistoryTier,
  range: { from: Date; to: Date },
  status: (code: 422, body: unknown) => unknown,
): Promise<unknown | undefined> {
  const refusal = await refuseIncompleteRange(tier, range);
  return refusal === null ? undefined : status(422, refusal);
}

/** The `[from, to)` a cost read covers: an explicit window, else a named range. */
async function costWindow(q: { from?: string; to?: string; range?: "today" | "month" | "year" }) {
  if (q.from && q.to) return { from: new Date(q.from), to: new Date(q.to) };
  return resolveRange(q.range ?? "month", await getPlantTimeZone());
}

export function historyRoutes({
  profile,
  sourceRequest,
  energyTarget,
  metricReadArgs,
  aggregateOf,
}: HistoryRoutesDeps) {
  const seriesArgs = async (q: {
    from: string;
    to: string;
    bucket: CostBucket;
    source?: string;
    inverterId?: string;
  }) => ({
    from: new Date(q.from),
    to: new Date(q.to),
    bucket: q.bucket,
    inverterId: await energyTarget(q),
  });

  return (
    new Elysia({ name: "history-routes" })
      .use(adminGuard)
      // Historical data (long form). Filter by metric / inverter; rollups live in
      // TimescaleDB continuous aggregates, this reads the raw hypertable. The
      // 720-hour cap is no longer the raw retention window — raw is kept 1825 days
      // — it is a bound on the RESPONSE: this returns individual rows, and a span
      // wide enough to matter is a rollup query. Longer spans go through
      // /api/history/rollup, whose minute tier now reads the same raw rows,
      // bucketed and time-weighted (apps/server/src/shared/rollup-sql.ts).
      .get(
        "/api/history",
        {
          requireSession: true,
          query: t.Object({
            hours: t.Number({ default: 24, minimum: 1, maximum: 720 }),
            limit: t.Number({ default: 5000, minimum: 1, maximum: 50000 }),
            metric: t.Optional(t.String()),
            source: t.Optional(t.String()),
            inverterId: t.Optional(t.String()),
          }),
        },
        async ({ query, status }) => {
          const since = new Date(Date.now() - query.hours * 60 * 60 * 1000);
          const refused = await guardRange("raw", { from: since, to: new Date() }, status);
          if (refused !== undefined) return refused;
          const filters = [gte(metricsRaw.time, since)];
          // Filtered BY id, resolved from the name the caller sent. `metric` and
          // `source` stay the query vocabulary: the int2 is a storage detail, and an
          // integer in a URL would be renumbered by a database restore. Absent, this
          // route means EVERY device; `source=plant` narrows to the members' own rows
          // (unfolded — the raw rows are per device by construction).
          if (query.metric) filters.push(eq(metricsRaw.metricId, metricIdOf(query.metric)));
          const req = parseSeriesSource(query);
          if (req) {
            const target = targetOf(req, req.kind === "plant" ? await historyMembers() : []);
            filters.push(deviceScope(target, getTableName(metricsRaw)));
          }
          // An EXPLICIT projection, joining the two dimensions back to their names.
          // This was `select *`, which after the 2.0.0 re-key would have started
          // returning `deviceId: 3, metricId: 41` to every client of a documented
          // endpoint — a silent wire-shape break, and two integers no consumer could
          // interpret. The response keeps the field names it always had.
          return db
            .select({
              time: metricsRaw.time,
              inverterId: devices.slug,
              metric: metricKeys.key,
              value: metricsRaw.value,
              durMs: metricsRaw.durMs,
            })
            .from(metricsRaw)
            .innerJoin(devices, eq(devices.id, metricsRaw.deviceId))
            .innerJoin(metricKeys, eq(metricKeys.id, metricsRaw.metricId))
            .where(and(...filters))
            .orderBy(desc(metricsRaw.time))
            .limit(query.limit);
        },
      )
      // Recent samples across all metrics, bucketed server-side and returned in the
      // compact `{ t0, step, metrics: { key: { o, v } } }` form — used to backfill
      // the client's in-memory live buffers so sparklines are populated immediately
      // on page load instead of rebuilding over several minutes.
      //
      // There is no `limit` parameter by design. The row count is bounded
      // structurally by the GROUP BY (`metricCount × (ceil(seconds / step) + 1)` —
      // the `+ 1` because `time_bucket` is epoch-aligned, so an N-second window
      // starting mid-bucket touches one bucket more than N/step). The old
      // client-supplied cap sat on a global `order by time desc`, so it truncated
      // the OLDEST samples of every metric at once — which is why the caller had to
      // send 200000 to reach back five minutes at all.
      .get(
        "/api/history/recent",
        {
          requireSession: true,
          query: t.Object({
            seconds: t.Number({ default: 300, minimum: 1, maximum: 3600 }),
            stepSeconds: t.Number({ default: 1, minimum: 1, maximum: 60 }),
            source: t.Optional(t.String()),
            inverterId: t.Optional(t.String()),
          }),
        },
        async ({ query, status }) => {
          const req = sourceRequest(query);
          if (!req) return status(503, ONBOARDING_REQUIRED);
          // The plant's backfill carries only the metrics that HAVE a plant value;
          // a per-device metric is simply absent from it, the way it is absent from
          // the plant's live reading.
          const plant =
            req.kind === "plant" ? { members: await historyMembers(), aggregateOf } : undefined;
          return queryRecentBuckets({
            inverterId: req.kind === "device" ? req.slug : "plant",
            seconds: query.seconds,
            stepSeconds: query.stepSeconds,
            ...(plant ? { plant } : {}),
          });
        },
      )
      // Downsampled history for charts. Reads TimescaleDB continuous aggregates
      // (`hourly_rollups` / `daily_rollups`) — pre-computed avg/max/min per
      // (inverter, metric) bucket — so a multi-week chart stays cheap. Returns
      // ascending time order (what charts expect). The views are created/refreshed
      // by raw SQL in packages/db (timescale.sql), so they're queried via `sql`
      // rather than a drizzle table.
      .get(
        "/api/history/rollup",
        {
          requireSession: true,
          query: t.Object({
            metric: t.String(),
            source: t.Optional(t.String()),
            inverterId: t.Optional(t.String()),
            bucket: t.Optional(t.Union([t.Literal("minute"), t.Literal("hour"), t.Literal("day")])),
            hours: t.Optional(t.Number({ minimum: 1 })),
            from: t.Optional(t.String()),
            to: t.Optional(t.String()),
            limit: t.Number({ default: 5000, minimum: 1, maximum: 50000 }),
          }),
        },
        async ({ query, status }) => {
          const req = sourceRequest(query);
          if (!req) return status(503, ONBOARDING_REQUIRED);
          const bucket = query.bucket ?? "hour";
          const window = historyWindow(query);
          const refused = await guardRange(
            TIER_OF[bucket] ?? "hour",
            { from: window.from ?? window.since ?? new Date(), to: window.to ?? new Date() },
            status,
          );
          if (refused !== undefined) return refused;
          const args = await metricReadArgs(req, query.metric);
          // A voltage, a phase, a status word: one machine's own state. The plant
          // has no such value, and an empty series would draw as a flat zero.
          if (isRefusal(args)) return status(422, args);
          return queryRollup({
            metric: query.metric,
            limit: query.limit,
            bucket,
            ...window,
            ...args,
          });
        },
      )
      // Cost breakdown over a named range (today / month-to-date / year-to-date) or
      // an explicit [from, to) window. Prices stored energy with the active tariff.
      .get(
        "/api/cost",
        {
          requireSession: true,
          query: t.Object({
            range: t.Optional(t.Union([t.Literal("today"), t.Literal("month"), t.Literal("year")])),
            from: t.Optional(t.String()),
            to: t.Optional(t.String()),
            source: t.Optional(t.String()),
            // fallow-ignore-next-line code-duplication -- dup:639f0435 — this is Elysia's handler preamble (an inverterId query field, then the onboarding-only 503 guard), shared with routes/battery.ts. Abstracting a route's signature to remove six lines would cost more clarity than the repetition does, and the guard is deliberately visible at every route that needs a profile.
            inverterId: t.Optional(t.String()),
          }),
        },
        async ({ query, status }) => {
          if (!profile) return status(503, ONBOARDING_REQUIRED);
          const { from, to } = await costWindow(query);
          // The named ranges are exactly the hazard: `month` and `year` open at a
          // boundary that can precede the cutover, and the answer would be a real
          // partial number labelled "month to date".
          const refused = await guardRange("hour", { from, to }, status);
          if (refused !== undefined) return refused;
          return computeCost(profile, { from, to, inverterId: await energyTarget(query) });
        },
      )
      // Net-cost time-series over an explicit [from, to) window, one point per
      // `bucket` (hour / day / month). Feeds the Costs page's range-driven bar chart;
      // band-accurate and cheap (delta + rollup done in SQL, bounded matrix returned).
      .get(
        "/api/cost/series",
        { requireSession: true, query: seriesQuery },
        async ({ query, status }) => {
          if (!profile) return status(503, ONBOARDING_REQUIRED);
          const args = await seriesArgs(query);
          const refused = await guardRange(TIER_OF[query.bucket] ?? "day", args, status);
          return refused ?? computeCostSeries(profile, args);
        },
      )
      // Per-period energy split (grid-vs-solar consumption, self-consumed-vs-exported
      // production) over the same window/bucket. Feeds the Costs page energy chart;
      // derived at query time from the rollups, zero-filled so the x-axis stays stable.
      .get(
        "/api/energy/series",
        { requireSession: true, query: seriesQuery },
        async ({ query, status }) => {
          if (!profile) return status(503, ONBOARDING_REQUIRED);
          const args = await seriesArgs(query);
          const refused = await guardRange(TIER_OF[query.bucket] ?? "day", args, status);
          return refused ?? energySeries(profile, args);
        },
      )
  );
}
