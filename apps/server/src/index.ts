import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { elysiaLogger } from "@logtape/elysia";
import { auth } from "@SunReye/auth";
import { db } from "@SunReye/db";
import { metricsRaw } from "@SunReye/db/schema/metrics";
import { user } from "@SunReye/db/schema/auth";
import { env } from "@SunReye/env/server";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { type CostBucket, computeCost, computeCostSeries, resolveRange } from "./energy/cost";
import { energySeries } from "./energy/energy";
import { entitiesApi } from "./inverter/entities";
import { evccControl, evccSnapshot, rebuildEvcc, stopEvcc } from "./evcc/evcc";
import { queryRollup } from "./shared/history";
import { isPublicDashboard } from "./settings/access-settings";
import { buildProfileContext, initProfiles } from "./inverter/inverter";
import { log, recentLogs, setupLogging } from "./shared/logging";
import { createStreams } from "./shared/streams";
import { initLogLevel } from "./settings/logging-settings";
import { adminRoutes } from "./routes/admin";
import { adminGuard } from "./routes/admin-guard";
import { customChartsRoutes } from "./routes/custom-charts";
import { startUpdateChecks, stopUpdateChecks } from "./inverter/profiles";
import { profileRoutes } from "./routes/profiles";
import { automationStreamSnapshot } from "./automation/automation";
import { automationRoutes } from "./routes/automations";
import { settingsRoutes } from "./routes/settings";
import { statisticsRoutes } from "./routes/statistics";
import { wsRoutes } from "./routes/ws";
import { createTopicAudience, publishTodayStatistics } from "./routes/ws-audience";
import { createTopicBackfill } from "./routes/ws-backfill";
import { publishLiveTopics } from "./routes/ws-publish";
import { topicAccessFrom } from "./routes/ws-subscribe";
import { todayStatistics } from "./statistics/statistics";
import * as runtime from "./inverter/runtime";

// Shared query for the per-period series endpoints (cost + energy): an explicit
// [from, to) window at a chosen bucket, plus an optional inverter override.
const seriesQuery = t.Object({
  from: t.String(),
  to: t.String(),
  bucket: t.Union([t.Literal("hour"), t.Literal("day"), t.Literal("month")]),
  inverterId: t.Optional(t.String()),
});
const seriesArgs = (q: { from: string; to: string; bucket: CostBucket; inverterId?: string }) => ({
  from: new Date(q.from),
  to: new Date(q.to),
  bucket: q.bucket,
  inverterId: q.inverterId,
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

/** The `[from, to)` a cost read covers: an explicit window, else a named range. */
function costWindow(q: { from?: string; to?: string; range?: "today" | "month" | "year" }) {
  if (q.from && q.to) return { from: new Date(q.from), to: new Date(q.to) };
  return resolveRange(q.range ?? "month");
}

/** Charge modes EVCC accepts on a `mode/set` command. */
const EVCC_MODES = ["off", "pv", "minpv", "now"];

/** Whether a relayed EVCC command carries a mode EVCC would reject. */
const unknownEvccMode = (body: { action: string; value: string | number }): boolean =>
  body.action === "mode" && !EVCC_MODES.includes(String(body.value));

/** Best-effort message for an unknown throw. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Container healthcheck self-probe: the runtime image is distroless (no shell,
// no curl), so orchestrators exec the server binary itself with --healthcheck.
// It probes the sibling server process over HTTP and exits 0/1 before any of
// the boot work below runs.
if (process.argv.includes("--healthcheck")) {
  try {
    const res = await fetch(`http://127.0.0.1:${env.PORT}/healthz`);
    process.exit(res.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

// The one read-side bus: every live feed (metrics, EVCC, logs, automations,
// statistics) is produced onto it and the WebSocket routes subscribe to it. It
// is owned here and injected into each producer — a single typed seam in place
// of the five hand-wired module sinks it replaces.
const streams = createStreams();

// Wire LogTape before anything logs (Elysia's request logger and the app
// loggers below both flow through the sinks configured here). The stream is
// injected now so a boot-time log line can already reach the `logs` topic.
await setupLogging(streams);
// Apply the persisted runtime log level now that the database is reachable;
// everything before this line logs at the boot default.
await initLogLevel();
const serverLog = log();

/**
 * Coax a human-readable message out of whatever a failed Modbus write threw.
 * modbus-serial rejects with Error subclasses and sometimes plain objects, so
 * `String(err)` alone can collapse to "[object Object]" and hide the cause. Pull
 * `message` directly (it reads even when non-enumerable) and append the modbus
 * exception code when present.
 */
function describeWriteError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { message?: unknown; modbusCode?: unknown };
  const detail = e.modbusCode === undefined ? "" : ` (modbusCode=${e.modbusCode})`;
  return `${String(e.message)}${detail}`;
}

// Two-phase profile boot: built-in packages self-register on import, then DB
// profiles are loaded and the active one resolved. Everything the transports
// need (manifest, catalog, write validation) is derived once here and injected,
// since the active profile is a boot concern (changing it requires a restart).
//
// When nothing is configured (`initProfiles` → null: a fresh install), the
// server boots in a degraded, onboarding-only mode. The route *shapes* stay
// identical (so the typed client is unaffected), but every profile-dependent
// handler short-circuits with 503 and the poll loop / MQTT bridge never start —
// the admin picks a profile from the first-run flow, then restarts into the
// full API.
const profile = await initProfiles();
const ctx = profile ? buildProfileContext(profile) : null;
const manifest = ctx?.manifest ?? null;
// 503 payload for a profile-dependent surface hit before onboarding is done.
const ONBOARDING_REQUIRED = { error: "No active inverter profile — onboarding required" } as const;
// Default inverter id for history reads that don't name one; null until onboarded.
const activeInverterId = profile?.id ?? null;

/**
 * The two topics whose producers ask "is anyone actually watching" before doing
 * the expensive work — see ./routes/ws-audience, which owns the pub/sub names
 * being counted. Wired here because the count needs `app.server`, which does
 * not exist until `.listen()` resolves; the predicates re-read it per call.
 */
const audience = createTopicAudience({ server: () => app.server ?? undefined });

/**
 * How often the statistics stream republishes today's figures. Faster than the
 * numbers actually move (the hourly rollups only refresh periodically; the live
 * `*.today` registers carry the in-progress day), but slow enough that the tick
 * is negligible — and it is skipped entirely with no subscribers.
 */
const STATISTICS_INTERVAL_MS = 15_000;

const app = new Elysia()
  // Structured HTTP request logging. Health/liveness probes are noisy and
  // uninteresting, so skip them.
  .use(
    elysiaLogger({
      // Log under the app root (as `server.http`) instead of the plugin's
      // default `elysia` category, so HTTP lines read like every other source.
      category: ["server", "http"],
      skip: (ctx) => ctx.path === "/" || ctx.path === "/healthz",
    }),
  )
  .use(
    cors({
      // In dev the web app may be served on any localhost port (Vite fallback,
      // VS Code port forwarding), so reflect any localhost origin. Production
      // pins to the configured origin; with CORS_ORIGIN unset (same-origin
      // deployments behind a reverse proxy) no origin is allowed and browsers
      // enforce plain same-origin — the safe default.
      origin:
        env.NODE_ENV === "production"
          ? (env.CORS_ORIGIN ?? [])
          : [
              /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
              ...(env.CORS_ORIGIN ? [env.CORS_ORIGIN] : []),
            ],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  )
  // Browsable docs (Scalar UI at /openapi, spec at /openapi/json) for the
  // auto-generated third-party API. Tags group the generated entity/command ops.
  .use(
    openapi({
      // Entity keys are dotted (e.g. `settings.battery.grid_charge`) and appear
      // in the generated write-route paths. Without this the plugin treats any
      // path containing "." as a static file and omits every command route.
      exclude: { staticFile: false },
      documentation: {
        info: {
          title: "SunReye Inverter API",
          version: "1.0.0",
          description:
            "Third-party integration API. Every entity and command is generated from the active inverter profile.",
        },
        tags: [
          { name: "Entities", description: "Read inverter entities and their history." },
          { name: "Commands", description: "Write validated settings to the inverter." },
        ],
      },
    }),
  )
  // Auto-generated `/api/v1` integration surface (entity catalog, state,
  // history, and one validated write route per writable entity). Writes go
  // through the runtime controller's live source.
  .use(entitiesApi({ ctx, write: runtime.write }))
  // Admin gate for privileged mutations — see ./routes/admin-guard.
  .use(adminGuard)
  // Hand the raw request to Better Auth. `parse: "none"` stops Elysia from
  // consuming the request body — other routes in this app define body schemas,
  // which turns on body parsing app-wide, and a parsed (consumed) stream makes
  // Better Auth's own body read throw `ERR_BODY_ALREADY_USED`. This is the same
  // technique Elysia's own `.mount()` uses to forward to a sub-handler.
  .all(
    "/api/auth/*",
    async (context) => {
      const { request, status } = context;
      if (["POST", "GET"].includes(request.method)) {
        return auth.handler(request);
      }
      return status(405);
    },
    { parse: "none" },
  )
  .get("/", () => "OK")
  // Readiness: proves the process is up *and* the database answers. Target of
  // the --healthcheck self-probe, compose healthchecks, and the Home Assistant
  // addon watchdog. Onboarding state doesn't matter here — a booted
  // onboarding-only server is healthy.
  .get("/healthz", async ({ status }) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { ok: true, profile: profile?.id ?? null };
    } catch {
      return status(503, { ok: false });
    }
  })
  // First-run gate for the web app: true until the instance has its first
  // (admin) account. Public — the onboarding flow can't be authenticated yet.
  .get("/api/setup-status", async () => {
    const [row] = await db.select({ n: count() }).from(user);
    return { needsSetup: (row?.n ?? 0) === 0 };
  })
  // First-run profile gate for the web app: true until a profile is active.
  // Public + independent of runtime health so the onboarding flow can read it
  // even while the server is booted onboarding-only.
  .get("/api/profile-status", () => ({
    needsProfile: profile === null,
    activeProfileId: profile?.id ?? null,
  }))
  // Public read of the anonymous-dashboard toggle. Lets the web shell decide
  // whether a logged-out visitor gets the read-only dashboard or the login page.
  // Exposes only the on/off boolean (already inferable by probing a read), never
  // the rest of the access config, which stays admin-only via /api/settings/access.
  .get("/api/access-status", async () => ({
    publicDashboard: await isPublicDashboard(),
  }))
  // Capability manifest for the active inverter profile: capabilities + a
  // render-ready metric catalog (role, kind, range, enum labels, flow). The UI
  // builds itself from this — no per-inverter code. 503 until a profile is active.
  .get("/api/profile", ({ status }) => manifest ?? status(503, ONBOARDING_REQUIRED), {
    requireSession: true,
  })
  // Historical data (long form). Filter by metric / inverter; rollups live in
  // TimescaleDB continuous aggregates, this reads the raw hypertable. Capped to
  // the raw retention window (30 days) so it never queries dropped chunks —
  // longer spans must go through /api/history/rollup.
  .get(
    "/api/history",
    async ({ query }) => {
      const since = new Date(Date.now() - query.hours * 60 * 60 * 1000);
      const filters = [gte(metricsRaw.time, since)];
      if (query.metric) filters.push(eq(metricsRaw.metric, query.metric));
      if (query.inverterId) filters.push(eq(metricsRaw.inverterId, query.inverterId));
      return db
        .select()
        .from(metricsRaw)
        .where(and(...filters))
        .orderBy(desc(metricsRaw.time))
        .limit(query.limit);
    },
    {
      requireSession: true,
      query: t.Object({
        hours: t.Number({ default: 24, minimum: 1, maximum: 720 }),
        limit: t.Number({ default: 5000, minimum: 1, maximum: 50000 }),
        metric: t.Optional(t.String()),
        inverterId: t.Optional(t.String()),
      }),
    },
  )
  // Recent raw samples across all metrics, ascending — used to backfill the
  // client's in-memory live buffers so sparklines are populated immediately on
  // page load instead of rebuilding over several minutes.
  .get(
    "/api/history/recent",
    async ({ query, status }) => {
      const inverterId = query.inverterId ?? activeInverterId;
      if (!inverterId) return status(503, ONBOARDING_REQUIRED);
      const since = new Date(Date.now() - query.seconds * 1000);
      // Most-recent-first so a capped result keeps the latest samples (the
      // client sorts ascending per metric).
      const rows = await db
        .select()
        .from(metricsRaw)
        .where(and(gte(metricsRaw.time, since), eq(metricsRaw.inverterId, inverterId)))
        .orderBy(desc(metricsRaw.time))
        .limit(query.limit);
      return rows.map((r) => ({ time: r.time.toISOString(), metric: r.metric, value: r.value }));
    },
    {
      requireSession: true,
      query: t.Object({
        seconds: t.Number({ default: 300, minimum: 1, maximum: 3600 }),
        inverterId: t.Optional(t.String()),
        limit: t.Number({ default: 50000, minimum: 1, maximum: 200000 }),
      }),
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
    async ({ query, status }) => {
      const inverterId = query.inverterId ?? activeInverterId;
      if (!inverterId) return status(503, ONBOARDING_REQUIRED);
      return queryRollup({
        metric: query.metric,
        inverterId,
        limit: query.limit,
        bucket: query.bucket ?? "hour",
        ...historyWindow(query),
      });
    },
    {
      requireSession: true,
      query: t.Object({
        metric: t.String(),
        inverterId: t.Optional(t.String()),
        bucket: t.Optional(t.Union([t.Literal("minute"), t.Literal("hour"), t.Literal("day")])),
        hours: t.Optional(t.Number({ minimum: 1 })),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        limit: t.Number({ default: 5000, minimum: 1, maximum: 50000 }),
      }),
    },
  )
  // Internal write pipeline for the (session-authed) web app. Validates the key
  // and value against the entity's metadata before touching the inverter — the
  // external `/api/v1` surface enforces the same rules via generated schemas.
  .post(
    "/api/commands/setting",
    async ({ body, status }) => {
      if (!ctx) return status(503, ONBOARDING_REQUIRED);
      const error = ctx.validateWrite(body.key, body.value);
      if (error) return status(400, { error });
      try {
        await runtime.write(body.key, body.value);
      } catch (err) {
        // The inverter didn't accept/answer the write (e.g. Modbus timeout or
        // exception response). Log the real cause and surface it as a gateway
        // error rather than a bare 500.
        const message = describeWriteError(err);
        serverLog.error("setting write failed key={key} value={value}: {message}", {
          key: body.key,
          value: body.value,
          message,
        });
        return status(502, { error: message });
      }
      return { ok: true, key: body.key, value: body.value };
    },
    { requireAdmin: true, body: t.Object({ key: t.String(), value: t.Number() }) },
  )
  // EVCC loadpoint commands, relayed as MQTT `/set` publishes. EVCC applies
  // the change and republishes its state, so reads converge via the ingest —
  // there is no local echo to fake. Value validation is per action: the mode
  // enum is checked here; limitSoc bounds are enforced by the schema.
  .post(
    "/api/commands/evcc",
    ({ body, status }) => {
      if (unknownEvccMode(body)) return status(400, { error: `Invalid mode "${body.value}"` });
      try {
        evccControl(body.loadpoint, body.action, String(body.value));
      } catch (err) {
        return status(503, { error: messageOf(err) });
      }
      return { ok: true };
    },
    {
      requireAdmin: true,
      body: t.Union([
        t.Object({
          loadpoint: t.Integer({ minimum: 1 }),
          action: t.Literal("mode"),
          value: t.String(),
        }),
        t.Object({
          loadpoint: t.Integer({ minimum: 1 }),
          action: t.Literal("limitSoc"),
          value: t.Integer({ minimum: 0, maximum: 100 }),
        }),
      ]),
    },
  )
  // Runtime configuration (tariff, inverter, MQTT) + connection status.
  .use(settingsRoutes)
  // Automations config + live engine status (peak shaving).
  .use(automationRoutes)
  // Cost breakdown over a named range (today / month-to-date / year-to-date) or
  // an explicit [from, to) window. Prices stored energy with the active tariff.
  .get(
    "/api/cost",
    ({ query, status }) => {
      if (!profile) return status(503, ONBOARDING_REQUIRED);
      const { from, to } = costWindow(query);
      return computeCost(profile, { from, to, inverterId: query.inverterId });
    },
    {
      requireSession: true,
      query: t.Object({
        range: t.Optional(t.Union([t.Literal("today"), t.Literal("month"), t.Literal("year")])),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        inverterId: t.Optional(t.String()),
      }),
    },
  )
  // Net-cost time-series over an explicit [from, to) window, one point per
  // `bucket` (hour / day / month). Feeds the Costs page's range-driven bar chart;
  // band-accurate and cheap (delta + rollup done in SQL, bounded matrix returned).
  .get(
    "/api/cost/series",
    ({ query, status }) =>
      profile ? computeCostSeries(profile, seriesArgs(query)) : status(503, ONBOARDING_REQUIRED),
    { requireSession: true, query: seriesQuery },
  )
  // Per-period energy split (grid-vs-solar consumption, self-consumed-vs-exported
  // production) over the same window/bucket. Feeds the Costs page energy chart;
  // derived at query time from the rollups, zero-filled so the x-axis stays stable.
  .get(
    "/api/energy/series",
    ({ query, status }) =>
      profile ? energySeries(profile, seriesArgs(query)) : status(503, ONBOARDING_REQUIRED),
    { requireSession: true, query: seriesQuery },
  )
  // Statistics-page aggregates (hour×weekday heatmap, …) over the same rollups.
  .use(statisticsRoutes({ profile }))
  // Profile management: registered list, repo sources, browse/install/activate.
  .use(profileRoutes)
  // User-defined custom charts for the history page (multi-metric overlays).
  .use(customChartsRoutes({ ctx }))
  // Admin-only maintenance: data reset + API-key administration.
  .use(adminRoutes)
  // The live socket: one connection carrying every topic, gated per subscribe
  // frame rather than per URL. It replaced five single-purpose /ws/* routes
  // (metrics, evcc, statistics, logs, automations), whose upgrade guards became
  // the per-topic policy table in ./routes/ws-topics and whose on-open sends
  // became the per-topic backfill table in ./routes/ws-backfill.
  .use(
    wsRoutes({
      streams,
      // Rebuilt from the request's own headers on every frame — the socket
      // never caches who it is talking to. `isPublicDashboard()` is read here
      // too, so flipping the kiosk toggle takes effect on the next subscribe
      // without reconnecting.
      access: async (headers) =>
        topicAccessFrom(
          (await auth.api.getSession({ headers }))?.user ?? null,
          await isPublicDashboard(),
        ),
      // Subscribe-time snapshots, mirroring what each old route sent on `open`
      // — see ./routes/ws-backfill, which owns the table and the `metrics`
      // omission.
      backfill: createTopicBackfill({
        profile,
        evccSnapshot,
        todayStatistics,
        automationStreamSnapshot,
        recentLogs,
      }),
    }),
  )
  .listen({ port: env.PORT, hostname: env.HOST }, () => {
    serverLog.info("server running on http://localhost:{port} — profile {profile}", {
      port: env.PORT,
      profile: profile?.id ?? "(onboarding-only)",
    });
  });

// The read-side bus's only sink: each live payload is enveloped and published
// to the `/ws` subscribers of its topic (see ./routes/ws-publish, which owns
// the topic names and the log coalescing). Registered before `app.server`
// exists — the publisher is re-read per emit, so the publishes are no-ops until
// `.listen()` resolves.
publishLiveTopics({ streams, publisher: () => app.server ?? undefined });

// Start the runtime controller: it owns the poll loop, the live source, and the
// MQTT bridge (all hot-reconfigurable). Each sample is emitted on the `metrics`
// topic; persistence + MQTT publishing happen inside the controller. Skipped in
// onboarding-only boot — there's no profile to poll yet.
if (ctx) {
  // The audience predicate: the engine's per-tick broadcast (and the plan
  // projection built only for it) is skipped while no `/ws` connection holds
  // the `automations` topic. Read per tick, never captured — a page opened an
  // hour from now must start receiving frames on the very next tick.
  runtime.start(streams, ctx, audience.automations);
}

// Periodically sync profile repos and diff installed versions so the UI can
// surface "update available" without the admin manually browsing. Independent
// of the poll loop — runs even in onboarding-only boot.
startUpdateChecks();

// EVCC ingest (own MQTT client on the shared broker). Independent of the
// inverter runtime — starts even in onboarding-only boot; no-op when disabled.
// Each coalesced snapshot is emitted on the `evcc` topic (the bus is wired on
// this boot rebuild); late/new subscribers get the current snapshot from the
// socket's `open` handler instead.
void rebuildEvcc(streams);

// Statistics stream: republish today's figures on a slow tick; the runtime
// signals the same topic whenever a price sync stores fresh slots. The tick
// short-circuits with no subscribers, so an idle instance pays nothing for the
// feature — see ./routes/ws-audience, which owns that gate.
setInterval(
  () =>
    void publishTodayStatistics({
      profile,
      watched: audience.statistics,
      streams,
      todayStatistics,
    }),
  STATISTICS_INTERVAL_MS,
);

// Graceful shutdown: stop polling and release the transport + broker.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopUpdateChecks();
    await stopEvcc();
    await runtime.stop();
    process.exit(0);
  });
}

export type App = typeof app;
