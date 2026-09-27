import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { auth } from "@SunReye/auth";
import { db } from "@SunReye/db";
import { user } from "@SunReye/db/schema/auth";
import { env } from "@SunReye/env/server";
import { count, sql } from "drizzle-orm";
import { CORS_METHODS } from "./shared/cors-methods";
import { setupStaticTypebox } from "./shared/typebox-static";
import { Elysia, t } from "elysia";
import { autoHead } from "elysia/auto-head";
import { entitiesApi } from "./inverter/entities";
import { createSourceResolution } from "./shared/source-resolution";
import { historyMembers, sourcesRoutes } from "./routes/sources";
import { isPublicDashboard } from "./settings/access-settings";
import { initProfiles } from "./inverter/inverter";
import { composePlant } from "./plant/plant-wiring";
import { deviceRegistry } from "./devices/registry-instance";
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
import { deviceRoutes } from "./routes/devices";
import { integrationRoutes } from "./routes/integrations";
import { profileRoutes } from "./routes/profiles";
import { automationStreamSnapshot } from "./automation/automation";
import { automationRoutes } from "./routes/automations";
import { settingsRoutes } from "./routes/settings";
import { historyRoutes } from "./routes/history";
import { statisticsRoutes } from "./routes/statistics";
import { wsRoutes } from "./routes/ws";
import { createTopicAudience, publishTodayStatistics } from "./routes/ws-audience";
import { createTopicBackfill } from "./routes/ws-backfill";
import { publishLiveTopics } from "./routes/ws-publish";
import { topicAccessFrom } from "./routes/ws-subscribe";
import { todayStatistics } from "./statistics/statistics";
import { loadAssets } from "./web/loaded";
import { webRoutes } from "./web/static";
import { compression } from "./shared/compression";

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

// The poll loop, the EVCC ingest, the connection probes and the plant runtime
// over them, built once the bus exists (./plant/plant-wiring.ts). The plant's
// lifecycle — provisioning, the broker seed, the roster, the transports'
// context, the live fold and the Home Assistant discovery gate, in that order —
// is ./plant/plant-runtime.ts's, where the order is tested. Its first half runs
// here, before any route is built from the context it returns; `booted.start`
// runs the second once the server is listening.
const { plant, runtime, evcc, probes } = composePlant({ profile, streams });
const booted = await plant.boot();
const ctx = booted.ctx;
const manifest = ctx?.manifest ?? null;

// WHERE a stored-data read is from: the named source, else the primary device.
// See ./shared/source-resolution.
const sources = createSourceResolution({
  primarySlug: () => deviceRegistry.primary()?.id ?? null,
  members: historyMembers,
  metaByKey: ctx?.metaByKey ?? new Map(),
});

/** Today's statistics for the primary device — the slug the live sample carries. */
const todayStatisticsForPrimary = (p: Parameters<typeof todayStatistics>[0]) =>
  todayStatistics(p, sources.defaultSourceId() ?? undefined);

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
      methods: [...CORS_METHODS],
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
  .use(entitiesApi({ ctx, write: runtime.write, members: historyMembers }))
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
  // Stored-data reads: raw history, the live-buffer backfill, chart rollups,
  // and the cost / energy series — see ./routes/history.
  .use(historyRoutes({ profile, sources }))
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
        evcc.control(body.loadpoint, body.action, String(body.value));
      } catch (err) {
        return status(503, { error: messageOf(err) });
      }
      return { ok: true };
    },
  )
  // Runtime configuration (tariff, inverter, MQTT) + connection status.
  .use(settingsRoutes({ plant, evcc, runtime, probes }))
  // Automations config + live engine status (peak shaving).
  .use(automationRoutes)
  // Statistics-page aggregates (hour×weekday heatmap, …) over the same rollups.
  .use(statisticsRoutes({ profile, target: sources.energyTarget }))
  .use(sourcesRoutes)
  // Profile management: registered list, repo sources, browse/install/activate.
  .use(batteryRoutes({ profile }))
  .use(profileRoutes)
  // The device roster: list, add on an existing or new gateway, rename, retire.
  .use(deviceRoutes(plant))
  // The other half of the same page: what RUNS over those endpoints — the EVCC
  // ingest and the Home Assistant export as rows, plus the catalog the wizard
  // renders its add step from.
  .use(integrationRoutes(plant))
  // User-defined custom charts for the history page (multi-metric overlays).
  .use(customChartsRoutes({ ctx }))
  // The 1.2.0 -> 2.0.0 migration's onboarding surface: the status every page load
  // reads, the two names that release Home Assistant discovery, the one-time slug
  // correction, and "migrate history now / later".
  .use(migrationRoutes({ manifest }))
  // Admin-only maintenance: data reset + API-key administration.
  .use(adminRoutes(runtime))
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
        evccSnapshot: evcc.snapshot,
        todayStatistics: todayStatisticsForPrimary,
        automationStreamSnapshot,
        recentLogs,
        plantSnapshot: () => booted.plantLive.snapshot(),
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

// The second half of the plant's boot: the poll loop (or, with no profile, the
// flush cadence alone), then the connection tier, then the EVCC ingest — see
// ./plant/plant-runtime.ts for why in that order. The audience predicate lets
// the engine skip its per-tick broadcast while no `/ws` connection holds the
// `automations` topic; it is read per tick, never captured.
await booted.start(audience.automations);

// Measure the battery's usable capacity from the discharge segments in raw
// history — one catch-up pass over the retention window, then a slow tick.
// No-op on a profile that maps no SOC, so a batteryless plant pays nothing.
const stopBatteryScoring = startBatteryScoring(profile);

// Periodically sync profile repos and diff installed versions so the UI can
// surface "update available" without the admin manually browsing. Independent
// of the poll loop — runs even in onboarding-only boot.
startUpdateChecks();

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
      todayStatistics: todayStatisticsForPrimary,
    }),
  STATISTICS_INTERVAL_MS,
);

// Graceful shutdown: stop polling and release the transport + broker.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopBatteryScoring();
    stopUpdateChecks();
    // EVCC, the poll loop, then the connection tier — ./plant/plant-runtime.ts.
    await plant.stop();
    process.exit(0);
  });
}

export type App = typeof app;
