import type { InverterProfile } from "@SunReye/inverter-core";
import { Elysia, t } from "elysia";
import { computeSpotStats } from "../statistics/spot-stats";
import type { SeriesTarget } from "../shared/plant-source";
import { computeComparison, computeHeatmap, computeRecords } from "../statistics/statistics";
import { adminGuard } from "./admin-guard";

// 503 payload for a statistics read attempted before onboarding is done (no
// profile → no rollup metrics to aggregate).
const ONBOARDING_REQUIRED = { error: "No active inverter profile — onboarding required" } as const;

// Explicit [from, to) window plus an optional inverter override — the
// statistics twin of index.ts's seriesQuery, minus `bucket` (each statistics
// endpoint fixes its own granularity).
const windowQuery = t.Object({
  from: t.String(),
  to: t.String(),
  source: t.Optional(t.String()),
  inverterId: t.Optional(t.String()),
});

/** The two spellings of where a read is from — see index.ts's `energyTarget`. */
const sourceQuery = { source: t.Optional(t.String()), inverterId: t.Optional(t.String()) };
type SourceQuery = { source?: string; inverterId?: string };

// windowQuery plus the reference-window mode for the comparison endpoint.
const comparisonQuery = t.Object({
  from: t.String(),
  to: t.String(),
  mode: t.Union([t.Literal("previous"), t.Literal("yearAgo")]),
  ...sourceQuery,
});

export interface StatisticsRoutesDeps {
  /** Active inverter profile — `null` in onboarding-only boot (routes 503). */
  profile: InverterProfile | null;
  /** The read target a request names (`source=plant` resolves to the member set). */
  target: (q: SourceQuery) => Promise<SeriesTarget | undefined>;
}

/**
 * Read-only statistics-page aggregates. Session-gated like the other
 * dashboard reads; every handler is a thin parse-and-delegate over
 * {@link ../statistics/statistics}.
 */
export function statisticsRoutes({ profile, target }: StatisticsRoutesDeps) {
  /** Parsed Date window from a validated {@link windowQuery}. */
  const windowArgs = async (q: { from: string; to: string } & SourceQuery) => ({
    from: new Date(q.from),
    to: new Date(q.to),
    inverterId: await target(q),
  });
  return (
    new Elysia({ name: "statistics-routes" })
      .use(adminGuard)
      // Hour×weekday energy heatmap over an explicit window (clamped to the
      // 730-day hourly-rollup horizon). All energy fields per cell so the
      // client switches metric without refetching.
      .get(
        "/api/statistics/heatmap",
        { requireSession: true, query: windowQuery },
        async ({ query, status }) =>
          profile
            ? computeHeatmap(profile, await windowArgs(query))
            : status(503, ONBOARDING_REQUIRED),
      )
      // Cost breakdowns for a window and its reference window (previous /
      // yearAgo) side by side, plus how far back recorded data reaches.
      .get(
        "/api/statistics/comparison",
        { requireSession: true, query: comparisonQuery },
        async ({ query, status }) =>
          profile
            ? computeComparison(profile, { ...(await windowArgs(query)), mode: query.mode })
            : status(503, ONBOARDING_REQUIRED),
      )
      // All-time per-day energy + money records (rangeless; cached per local
      // day server-side since the in-progress day is excluded).
      .get(
        "/api/statistics/records",
        { requireSession: true, query: t.Object(sourceQuery) },
        async ({ query, status }) =>
          profile
            ? computeRecords(profile, { inverterId: await target(query) })
            : status(503, ONBOARDING_REQUIRED),
      )
      // Day-ahead market analytics over an explicit window: price shape, the
      // negative-price windows, and how the plant's own import compares.
      // `null` when the price feed isn't configured — the section self-hides.
      .get(
        "/api/statistics/prices",
        { requireSession: true, query: windowQuery },
        async ({ query, status }) =>
          profile
            ? computeSpotStats(profile, await windowArgs(query))
            : status(503, ONBOARDING_REQUIRED),
      )
  );
}
