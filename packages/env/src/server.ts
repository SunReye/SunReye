import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    // Base URL Better Auth advertises. Only meaningful for split-origin
    // deployments; same-origin (reverse-proxied) setups can leave it unset.
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    // Origin of a *split-origin* web app (plain docker-compose: web on :3001,
    // server on :3000). Unset = same-origin deployment (dev Vite proxy, the
    // Home Assistant addon's reverse proxy): CORS stays disabled and browsers
    // enforce same-origin, which is the safe default.
    CORS_ORIGIN: z.url().optional(),
    // Extra origins Better Auth's CSRF/origin check should trust, e.g. an
    // HTTPS reverse proxy in front of a direct-port deployment. Comma-separated.
    TRUSTED_ORIGINS: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    // Mark auth cookies `Secure`. Off by default so plain-HTTP LAN access
    // (direct addon port, compose without TLS) keeps working; HTTPS-only
    // deployments should turn it on.
    AUTH_SECURE_COOKIES: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // HTTP port the core engine listens on.
    PORT: z.coerce.number().int().positive().default(3000),
    // Interface the core engine binds. The Home Assistant addon sets 127.0.0.1
    // so only its reverse proxy can reach the API; containers default to all
    // interfaces.
    HOST: z.string().min(1).default("0.0.0.0"),

    // Lowest LogTape severity that reaches the console sink. Unset defaults to
    // "debug" in development and "info" otherwise (resolved in the logging setup).
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warning", "error", "fatal"]).optional(),
    // Per-category override for the MQTT transport (`server.mqtt`) — turn MQTT
    // logging up (debug) or down (warning) without touching the rest. Unset
    // inherits LOG_LEVEL.
    LOG_LEVEL_MQTT: z.enum(["trace", "debug", "info", "warning", "error", "fatal"]).optional(),

    // Inverter connection settings are optional at boot: they only *seed* the
    // DB-backed, UI-editable config on first run (see apps/server/src/settings/config.ts
    // and inverter.ts). Leave them unset to configure everything from the UI.
    //
    // Active inverter profile id (from an installed `@SunReye/inverter-*` package).
    // Unset falls back to the first registered (built-in) profile at boot.
    INVERTER_PROFILE: z.string().min(1).optional(),
    // Inverter (Modbus TCP) connection
    INVERTER_HOST: z.ipv4().or(z.ipv6()).optional(),
    INVERTER_PORT: z.coerce.number().int().positive().optional(),
    INVERTER_UNIT_ID: z.coerce.number().int().min(0).optional(),
    // Framing over the socket: standard Modbus `tcp`, or `rtu-over-tcp`
    // (RTU frames tunneled over TCP — common with RS485→Ethernet gateways).
    INVERTER_TRANSPORT: z.enum(["tcp", "rtu-over-tcp"]).optional(),
    // Polling cadence for the 1Hz God-loop (milliseconds)
    POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    // History rows are buffered in memory and flushed to TimescaleDB in one
    // transaction every this-many ms, instead of one INSERT per poll. Batching
    // collapses commit/fsync/WAL churn — the dominant driver of SSD write wear
    // (TBW) at 1 Hz — with no functional change: live data is served from memory
    // over WebSocket, not the DB, so *when* rows land is invisible. A crash can
    // lose at most this window of history (never live data, never corruption).
    // Set at or below POLL_INTERVAL_MS to effectively disable batching.
    HISTORY_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    // When true, generate synthetic metrics instead of talking to hardware
    INVERTER_SIMULATE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    // Comma-separated API keys authorizing third-party access to the public
    // `/api/v1` integration API (Authorization: Bearer <key> or x-api-key).
    // Empty is allowed in development (open); in production an empty list fails
    // closed and every `/api/v1` request is rejected.
    API_KEYS: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      ),

    // MQTT bridge: publishes each entity's value to `<prefix>/<inverterId>/<topic>`
    // (retained) and accepts writes on `.../set` for writable entities. Off by
    // default so the server never dials a broker unless asked to.
    MQTT_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    MQTT_BROKER_URL: z.string().default("mqtt://localhost:1883"),
    MQTT_TOPIC_PREFIX: z.string().min(1).default("sunreye"),
    MQTT_USERNAME: z.string().optional(),
    MQTT_PASSWORD: z.string().optional(),

    // Home Assistant MQTT Discovery: publishes retained entity configs under
    // `<HA_DISCOVERY_PREFIX>/...` so SunReye auto-populates in Home Assistant.
    // Requires MQTT_ENABLED.
    HA_DISCOVERY_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    HA_DISCOVERY_PREFIX: z.string().min(1).default("homeassistant"),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
