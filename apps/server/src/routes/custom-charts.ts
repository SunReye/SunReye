import { type CustomChartInput, customChartInputSchema } from "@SunReye/db/custom-charts";
import { Elysia, t } from "elysia";
import { createChart, deleteChart, listCharts, updateChart } from "../custom-charts";
import type { ProfileContext } from "../inverter";
import { adminGuard } from "./admin-guard";
import { errorMessage } from "./write-attempt";

// 503 payload for a write attempted before a profile is active (can't validate
// metric keys without a manifest).
const ONBOARDING_REQUIRED = { error: "No active inverter profile — onboarding required" } as const;

export interface CustomChartRoutesDeps {
  /** Active profile context (metric catalog) — `null` in onboarding-only boot. */
  ctx: ProfileContext | null;
}

/** First submitted metric key that isn't in the manifest, as an error, else null. */
function unknownMetric(ctx: ProfileContext, metrics: string[]): string | null {
  for (const key of metrics) {
    if (!ctx.metaByKey.has(key)) return `Unknown metric: ${key}`;
  }
  return null;
}

type ChartValidation =
  | { ok: true; input: CustomChartInput }
  | { ok: false; status: 400 | 503; error: string };

/** Validate a write body: needs an active profile, valid schema, known metrics. */
function validateChart(ctx: ProfileContext | null, body: unknown): ChartValidation {
  if (!ctx) return { ok: false, status: 503, error: ONBOARDING_REQUIRED.error };
  try {
    const input = customChartInputSchema.parse(body);
    const bad = unknownMetric(ctx, input.metrics);
    return bad ? { ok: false, status: 400, error: bad } : { ok: true, input };
  } catch (error) {
    return { ok: false, status: 400, error: errorMessage(error, "Invalid chart") };
  }
}

/**
 * User-defined custom charts for the history page. Reads ride the dashboard read
 * policy (session, or anonymous when the public dashboard is on) — the payload
 * is just metric keys + a chart type; writes are admin-gated and validated
 * against the shared Zod schema and the active profile's metric catalog.
 */
export function customChartsRoutes({ ctx }: CustomChartRoutesDeps) {
  return new Elysia({ name: "custom-charts-routes" })
    .use(adminGuard)
    .get("/api/custom-charts", () => listCharts(), { requireSession: true })
    .post(
      "/api/custom-charts",
      async ({ body, status }) => {
        const v = validateChart(ctx, body);
        if (!v.ok) return status(v.status, { error: v.error });
        return await createChart(v.input);
      },
      { requireAdmin: true, body: t.Unknown() },
    )
    .put(
      "/api/custom-charts/:id",
      async ({ params, body, status }) => {
        const v = validateChart(ctx, body);
        if (!v.ok) return status(v.status, { error: v.error });
        const chart = await updateChart(params.id, v.input);
        return chart ?? status(404, { error: "Chart not found" });
      },
      { requireAdmin: true, params: t.Object({ id: t.String() }), body: t.Unknown() },
    )
    .delete(
      "/api/custom-charts/:id",
      async ({ params, status }) => {
        const ok = await deleteChart(params.id);
        return ok ? { ok: true, id: params.id } : status(404, { error: "Chart not found" });
      },
      { requireAdmin: true, params: t.Object({ id: t.String() }) },
    );
}
