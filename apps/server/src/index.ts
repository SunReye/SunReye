import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { auth } from "@SunReye/auth";
import { db } from "@SunReye/db";
import { metricsRaw } from "@SunReye/db/schema/metrics";
import { devices, metricKeys } from "@SunReye/db/schema/plants";
import { user } from "@SunReye/db/schema/auth";
import { env } from "@SunReye/env/server";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { setupStaticTypebox } from "./shared/typebox-static";
import { Elysia, t } from "elysia";
import { autoHead } from "elysia/auto-head";
import { type CostBucket, computeCost, computeCostSeries, resolveRange } from "./energy/cost";
import { energySeries } from "./energy/energy";
import { entitiesApi } from "./inverter/entities";
import { ensureDevice, readPlant } from "@SunReye/db/plant-repo";
import { evccControl, evccSnapshot, rebuildEvcc, stopEvcc } from "./evcc/evcc";
import { loadpointDeviceSpec } from "./evcc/evcc-devices";
import { deviceIdOf, metricIdOf } from "./shared/identity-sql";
import { queryRecentBuckets, queryRollup } from "./shared/history";
import type { HistoryTier } from "./shared/history-horizon";
import { refuseIncompleteRange } from "./shared/history-horizon-live";
import { isPublicDashboard } from "./settings/access-settings";
import { buildProfileContext, initProfiles } from "./inverter/inverter";
import { deviceRegistry } from "./devices/registry-instance";
import { syncProvisioning } from "./inverter/provision-boot";
import { WriteRejectedError } from "./inverter/control-writer";
import { log, recentLogs, setupLogging } from "./shared/logging";
import { requestLogger } from "./shared/request-log";
import { createStreams } from "./shared/streams";
import { initLogLevel } from "./settings/logging-settings";
import { adminRoutes } from "./routes/admin";
import { adminGuard } from "./routes/admin-guard";
import { customChartsRoutes } from "./routes/custom-charts";
import { migrationRoutes } from "./routes/migration";
import { startBatteryScoring } from "./battery/scoring";
import { startUpdateChecks, stopUpdateChecks } from "./inverter/profiles";
import { batteryRoutes } from "./routes/battery";
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
import { loadAssets } from "./web/loaded";
import { webRoutes } from "./web/static";
import { compression } from "./shared/compression";

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
 * complete one. See `./shared/history-horizon.ts`; issue #154 is the same defect
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
// 503 payload for a profile-dependent surface hit before onboarding is done.
const ONBOARDING_REQUIRED = { error: "No active inverter profile — onboarding required" } as const;

// Provision the dimension spine: the plant, and — once a profile is active — its
// connection and the device every reading is FROM.
//
// This is what makes the write path able to store anything. `metrics_raw.device_id`
// is a NOT NULL foreign key, so the writer resolves a device before inserting and,
// finding none, drops the batch with one warning per source (see
// ./inverter/storage-identity.ts). Until this call existed a fresh 2.0.0 install
// recorded no history whatsoever.
//
// Before `runtime.start` below, deliberately: the first poll can land within a
// second of boot, and a device that appears only after it would have cost that
// sample. Idempotent, so every later boot adopts the same rows — never a second
// plant, and never a renumbered device id, which would rebind five years of
// readings to a different machine. Never throws.
await syncProvisioning(profile);

// The device roster, read AFTER provisioning created the rows and before any
// route can serve a history read from it. `runtime.start` reloads it again (it
// is idempotent) so a boot that never reaches the runtime — onboarding-only —
// still has one.
await deviceRegistry.reload();

// The transports' context, built AFTER the roster exists — the one reason this
// moved down from beside `initProfiles`.
//
// `/api/profile` serves a capability block, and that block now describes the
// registered DEVICE (`deriveCapabilities` over the roles it binds) rather than
// the boot profile object. For the only tier that exists today the two are the
// same expression over the same metric list, which is the parity this step is
// here to prove; what changes is that a tier with no register map at all (#88,
// #172) has something to serve, and that a device binding less than its profile
// describes stops claiming its profile's hardware.
//
// Identity and the metric catalog stay the profile's: a `ManifestMetric` carries
// a topic, a label, a range and enum labels, and only an authored register map
// states those. The primary inverter is the Phase 2b seam (`registry.primary`) —
// one manifest for the plant is the answer this deliverable deliberately does
// not revisit. It falls back to the profile when nothing registered, which is
// the pre-registry answer unchanged.
const ctx = profile ? buildProfileContext(profile, deviceRegistry.primary() ?? profile) : null;
const manifest = ctx?.manifest ?? null;

/**
 * The device a history read means when the request names none.
 *
 * The registry's primary inverter, by `devices.slug` — the id every row is
 * written under. It used to be `profile.id`, which worked only because both
 * resolvers carry a transitional `profile_id` arm; a plant with two inverters
 * has no answer in that spelling at all.
 */
const defaultSourceId = (): string | null => deviceRegistry.primary()?.id ?? null;

// HOLD HOME ASSISTANT DISCOVERY when a 1.x -> 2.0.0 migration has not been
// through onboarding yet. Before the MQTT bridge starts, necessarily: the
// announcement goes out inside MQTT's synchronous `connect` handler, which cannot
// await a database read, so the flag has to be set before anything dials.
//
// A discovery announcement is retained and Home Assistant keys its entities on
// `unique_id`. Announcing under the placeholder identity the migration
// synthesises is therefore not something a later rename can take back, so it
// waits for the operator's names — see ./migration/onboarding.ts. A no-op on
// every install that never ran a 1.x upgrade, which is the important half: a gate
// that engaged by accident looks exactly like a broken MQTT bridge.
//
// Never throws. A migration record that cannot be read must not stop the server
// booting; the gate simply stays open, which is the state every healthy install
// is in anyway.
try {
  const { readMigrationRecord } = await import("./migration/record");
  const { migrationGateReason } = await import("./migration/onboarding");
  const { holdDiscovery } = await import("./migration/discovery-gate");
  const { log } = await import("./shared/logging");
  const reason = migrationGateReason(await readMigrationRecord());
  if (reason !== null) {
    holdDiscovery(reason);
    log("migration").warn("Home Assistant discovery is held: {reason}", { reason });
  }
} catch (error) {
  const { log } = await import("./shared/logging");
  log("migration").warn("could not read the migration record; discovery is not held: {error}", {
    error: (error as Error).message,
  });
}

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

// Before any route is registered: Elysia 2 would otherwise `require()` TypeBox
// the first time it compiles a route with a schema, which a compiled binary
// cannot do. See ./shared/typebox-static.
setupStaticTypebox();

const app = new Elysia()
  // Response compression, first so it covers every route below — the API and
  // the dashboard bundle alike. See ./shared/compression for why these
  // encodings and not the best-compressing ones.
  .use(compression())
  // Structured HTTP request logging. Health/liveness probes are noisy and
  // uninteresting, so skip them.
  .use(
    requestLogger({
      // `/` is the dashboard page (served from the embedded build) and
      // `/healthz` the readiness probe — both are high-frequency and say
      // nothing about what the engine is doing.
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
  .all("/api/auth/*", { parse: "none" }, async (context) => {
    const { request, status } = context;
    if (["POST", "GET"].includes(request.method)) {
      return auth.handler(request);
    }
    return status(405);
  })
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
  .get(
    "/api/profile",
    {
      requireSession: true,
    },
    ({ status }) => manifest ?? status(503, ONBOARDING_REQUIRED),
  )
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
        inverterId: t.Optional(t.String()),
      }),
    },
    async ({ query, status }) => {
      const since = new Date(Date.now() - query.hours * 60 * 60 * 1000);
      const refused = await guardRange("raw", { from: since, to: new Date() }, status);
      if (refused !== undefined) return refused;
      const filters = [gte(metricsRaw.time, since)];
      // Filtered BY id, resolved from the name the caller sent. `metric` and
      // `inverterId` stay the query vocabulary: the int2 is a storage detail, and
      // an integer in a URL would be renumbered by a database restore.
      if (query.metric) filters.push(eq(metricsRaw.metricId, metricIdOf(query.metric)));
      if (query.inverterId) filters.push(eq(metricsRaw.deviceId, deviceIdOf(query.inverterId)));
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
        inverterId: t.Optional(t.String()),
      }),
    },
    async ({ query, status }) => {
      const inverterId = query.inverterId ?? defaultSourceId();
      if (!inverterId) return status(503, ONBOARDING_REQUIRED);
      return queryRecentBuckets({
        inverterId,
        seconds: query.seconds,
        stepSeconds: query.stepSeconds,
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
        inverterId: t.Optional(t.String()),
        bucket: t.Optional(t.Union([t.Literal("minute"), t.Literal("hour"), t.Literal("day")])),
        hours: t.Optional(t.Number({ minimum: 1 })),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        limit: t.Number({ default: 5000, minimum: 1, maximum: 50000 }),
      }),
    },
    async ({ query, status }) => {
      const inverterId = query.inverterId ?? defaultSourceId();
      if (!inverterId) return status(503, ONBOARDING_REQUIRED);
      const bucket = query.bucket ?? "hour";
      const window = historyWindow(query);
      const refused = await guardRange(
        TIER_OF[bucket] ?? "hour",
        { from: window.from ?? window.since ?? new Date(), to: window.to ?? new Date() },
        status,
      );
      if (refused !== undefined) return refused;
      return queryRollup({
        metric: query.metric,
        inverterId,
        limit: query.limit,
        bucket,
        ...window,
      });
    },
  )
  // Internal write pipeline for the (session-authed) web app. The write funnel
  // validates the key and value against the entity's metadata before touching
  // the inverter — the external `/api/v1` surface travels the same funnel.
  .post(
    "/api/commands/setting",
    { requireAdmin: true, body: t.Object({ key: t.String(), value: t.Number() }) },
    async ({ body, status }) => {
      if (!ctx) return status(503, ONBOARDING_REQUIRED);
      try {
        await runtime.write(body.key, body.value);
      } catch (err) {
        // The funnel validates key and value; a rejection there is the caller's
        // mistake, not the inverter's, so it stays a 400 and is never logged as
        // a device failure.
        if (err instanceof WriteRejectedError) return status(400, { error: err.message });
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
  )
  // EVCC loadpoint commands, relayed as MQTT `/set` publishes. EVCC applies
  // the change and republishes its state, so reads converge via the ingest —
  // there is no local echo to fake. Value validation is per action: the mode
  // enum is checked here; limitSoc bounds are enforced by the schema.
  .post(
    "/api/commands/evcc",
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
    ({ body, status }) => {
      if (unknownEvccMode(body)) return status(400, { error: `Invalid mode "${body.value}"` });
      try {
        evccControl(body.loadpoint, body.action, String(body.value));
      } catch (err) {
        return status(503, { error: messageOf(err) });
      }
      return { ok: true };
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
    {
      requireSession: true,
      query: t.Object({
        range: t.Optional(t.Union([t.Literal("today"), t.Literal("month"), t.Literal("year")])),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        // fallow-ignore-next-line code-duplication -- dup:639f0435 — this is Elysia's handler preamble (an inverterId query field, then the onboarding-only 503 guard), shared with routes/battery.ts. Abstracting a route's signature to remove six lines would cost more clarity than the repetition does, and the guard is deliberately visible at every route that needs a profile.
        inverterId: t.Optional(t.String()),
      }),
    },
    async ({ query, status }) => {
      if (!profile) return status(503, ONBOARDING_REQUIRED);
      const { from, to } = costWindow(query);
      // The named ranges are exactly the hazard: `month` and `year` open at a
      // boundary that can precede the cutover, and the answer would be a real
      // partial number labelled "month to date".
      const refused = await guardRange("hour", { from, to }, status);
      if (refused !== undefined) return refused;
      return computeCost(profile, { from, to, inverterId: query.inverterId });
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
      const args = seriesArgs(query);
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
      const args = seriesArgs(query);
      const refused = await guardRange(TIER_OF[query.bucket] ?? "day", args, status);
      return refused ?? energySeries(profile, args);
    },
  )
  // Statistics-page aggregates (hour×weekday heatmap, …) over the same rollups.
  .use(statisticsRoutes({ profile }))
  // Profile management: registered list, repo sources, browse/install/activate.
  .use(batteryRoutes({ profile }))
  .use(profileRoutes)
  // User-defined custom charts for the history page (multi-metric overlays).
  .use(customChartsRoutes({ ctx }))
  // The 1.2.0 -> 2.0.0 migration's onboarding surface: the status every page load
  // reads, the two names that release Home Assistant discovery, the one-time slug
  // correction, and "migrate history now / later".
  .use(migrationRoutes({ manifest }))
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
  // The dashboard itself, served from the build embedded in this binary. Mounted
  // LAST so every engine route above claims its path first: this answers GET on
  // whatever is left, with the SPA page as the fallback (hash router). Absent in
  // an API-only build (compiled without --asset) — then these paths simply 404.
  .use(webRoutes(await loadAssets()))
  // HEAD for every GET above, answered with the headers and no body. Mounted
  // LAST and on purpose: it derives the HEAD routes from the ones already
  // registered, so anything added after it would not get one. Elysia 1 answered
  // HEAD on a `.get` for free; Elysia 2 404s it without this.
  .use(autoHead())
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

// Measure the battery's usable capacity from the discharge segments in raw
// history — one catch-up pass over the retention window, then a slow tick.
// No-op on a profile that maps no SOC, so a batteryless plant pays nothing.
const stopBatteryScoring = startBatteryScoring(profile);

// Periodically sync profile repos and diff installed versions so the UI can
// surface "update available" without the admin manually browsing. Independent
// of the poll loop — runs even in onboarding-only boot.
startUpdateChecks();

// EVCC ingest (own MQTT client on the shared broker). Independent of the
// inverter runtime — starts even in onboarding-only boot; no-op when disabled.
// Each coalesced snapshot is emitted on the `evcc` topic (the bus is wired on
// this boot rebuild); late/new subscribers get the current snapshot from the
// socket's `open` handler instead.
//
// The second argument is the path from a loadpoint to `metrics_raw`: a device
// row per loadpoint, then the runtime's ONE wired writer. Before it, nothing
// under `src/evcc/` wrote to the hypertable at all — charge power and session
// energy were live-feed only, with no history, no rollups and no statistics.
// Assembled here because it is composition: the ingest owns none of these.
void rebuildEvcc(streams, {
  async ensureDevice(_id, index, title) {
    const plant = await readPlant({ execute: (query) => db.execute(query) });
    // Onboarding-only boot: EVCC ingest starts before there is a plant to hang a
    // device on. The live feed runs; storage starts on the next snapshot after
    // provisioning.
    if (!plant) return false;
    await ensureDevice(
      { execute: (query) => db.execute(query) },
      loadpointDeviceSpec(plant.id, index, title),
    );
    return true;
  },
  reloadRegistry: async () => void (await deviceRegistry.reload()),
  device: (id) => deviceRegistry.get(id),
  commit: runtime.commit,
  forgetDevice: runtime.forgetDevice,
  logger: log("evcc"),
});

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
    stopBatteryScoring();
    stopUpdateChecks();
    await stopEvcc();
    await runtime.stop();
    process.exit(0);
  });
}

export type App = typeof app;
