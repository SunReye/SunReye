import type { InverterProfile } from "@SunReye/inverter-core";
import { Elysia, t } from "elysia";
import { computeSpotStats } from "../statistics/spot-stats";
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
  inverterId: t.Optional(t.String()),
});

// windowQuery plus the reference-window mode for the comparison endpoint.
const comparisonQuery = t.Object({
  from: t.String(),
  to: t.String(),
  mode: t.Union([t.Literal("previous"), t.Literal("yearAgo")]),
  inverterId: t.Optional(t.String()),
});

/** Parsed Date window from a validated {@link windowQuery}. */
const windowArgs = (q: { from: string; to: string; inverterId?: string }) => ({
  from: new Date(q.from),
  to: new Date(q.to),
  inverterId: q.inverterId,
});

export interface StatisticsRoutesDeps {
  /** Active inverter profile — `null` in onboarding-only boot (routes 503). */
  profile: InverterProfile | null;
}

/**
 * Read-only statistics-page aggregates. Session-gated like the other
 * dashboard reads; every handler is a thin parse-and-delegate over
 * {@link ../statistics/statistics}.
 */
export function statisticsRoutes({ profile }: StatisticsRoutesDeps) {
  return (
    new Elysia({ name: "statistics-routes" })
      .use(adminGuard)
      // Hour×weekday energy heatmap over an explicit window (clamped to the
      // 730-day hourly-rollup horizon). All energy fields per cell so the
      // client switches metric without refetching.
      .get(
        "/api/statistics/heatmap",
        ({ query, status }) =>
          profile ? computeHeatmap(profile, windowArgs(query)) : status(503, ONBOARDING_REQUIRED),
        { requireSession: true, query: windowQuery },
      )
      // Cost breakdowns for a window and its reference window (previous /
      // yearAgo) side by side, plus how far back recorded data reaches.
      .get(
        "/api/statistics/comparison",
        ({ query, status }) =>
          profile
            ? computeComparison(profile, { ...windowArgs(query), mode: query.mode })
            : status(503, ONBOARDING_REQUIRED),
        { requireSession: true, query: comparisonQuery },
      )
      // All-time per-day energy + money records (rangeless; cached per local
      // day server-side since the in-progress day is excluded).
      .get(
        "/api/statistics/records",
        ({ query, status }) =>
          profile
            ? computeRecords(profile, { inverterId: query.inverterId })
            : status(503, ONBOARDING_REQUIRED),
        { requireSession: true, query: t.Object({ inverterId: t.Optional(t.String()) }) },
      )
      // Day-ahead market analytics over an explicit window: price shape, the
      // negative-price windows, and how the plant's own import compares.
      // `null` when the price feed isn't configured — the section self-hides.
      .get(
        "/api/statistics/prices",
        ({ query, status }) =>
          profile ? computeSpotStats(profile, windowArgs(query)) : status(503, ONBOARDING_REQUIRED),
        { requireSession: true, query: windowQuery },
      )
  );
}
