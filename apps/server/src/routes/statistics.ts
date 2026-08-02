import type { InverterProfile } from "@SunReye/inverter-core";
import { Elysia, t } from "elysia";
import { computeHeatmap } from "../statistics";
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
 * {@link ../statistics}.
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
  );
}
