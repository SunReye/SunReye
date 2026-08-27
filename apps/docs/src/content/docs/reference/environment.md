---
title: Environment Variables
description: Every environment variable SunReye reads, with defaults and where they apply.
---

All environment variables are declared and validated in a single place — `packages/env`
(`server.ts` for the server, `web.ts` for the browser bundle) — using `@t3-oss/env-core`
+ Zod at import time. No other package parses `process.env` directly.

:::note[Only two are truly required]
`DATABASE_URL` and `BETTER_AUTH_SECRET` are the only variables without a default.
Everything else is optional — and every shipped deployment (dev, Docker Compose, the Home
Assistant addon) is same-origin now that the server serves the dashboard, so none of them
needs `CORS_ORIGIN` or `PUBLIC_SERVER_URL` at all.
:::

## Runtime config has moved into the UI

Much of what used to be env-only is now **DB-backed runtime configuration** editable from
the [Settings](/use/settings/) screen (no restart, no redeploy). For those variables the
env value is used **only as a seed** the first time the server boots with no saved setting;
once you save that setting from the UI, the env var is ignored.

Variables below are marked:

- **env-only** — always read from the environment.
- **seed only** — seeds a DB setting on first boot, then superseded by
  [Settings](/use/settings/).

## Core / infrastructure

| Variable | Type | Default | Required | Purpose |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | string | — | ✅ | PostgreSQL / TimescaleDB connection string. |
| `NODE_ENV` | `development` \| `production` \| `test` | `development` | | Runtime environment. |
| `PORT` | number | `3000` | | HTTP port the core engine listens on. |
| `HOST` | string | `0.0.0.0` | | Interface the core engine binds (the HA addon sets `127.0.0.1` behind its proxy). |
| `TZ` | IANA zone | host zone (`UTC` in containers) | | The site's time zone. Read by the runtime, not by SunReye's own config, but every day, month and tariff-band boundary is cut in it — see [Docker](/deploy/docker/#set-the-time-zone). |
| `LOG_LEVEL` | `trace` … `fatal` | `debug` (dev) / `info` | | Boot default for the lowest LogTape severity written to the console. Overridable at runtime in Settings → Logs (which persists across restarts). |
| `LOG_LEVEL_MQTT` | `trace` … `fatal` | inherits `LOG_LEVEL` | | Per-category override for the MQTT transport (`server.mqtt`) — turn MQTT logging up or down without touching the rest. |

## Auth

| Variable | Type | Default | Required | Purpose |
| --- | --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | string (≥32) | — | ✅ | Better Auth signing secret. |
| `BETTER_AUTH_URL` | url | `http://localhost:3000` | | Better Auth base URL (split-origin deployments only). |
| `CORS_ORIGIN` | url | — | | Allowed CORS origin for a *split-origin* dashboard. Unset = CORS disabled (same-origin deployments — the safe default). |
| `TRUSTED_ORIGINS` | comma-separated urls | `""` | | Extra origins Better Auth's CSRF check trusts (e.g. an HTTPS reverse proxy in front of a direct port). |
| `AUTH_SECURE_COOKIES` | boolean | `false` | | Mark session cookies `Secure`. Enable only on HTTPS-only deployments — over plain HTTP the browser drops the session. |

## Inverter / Modbus connection

| Variable | Type | Default | Status | Purpose |
| --- | --- | --- | --- | --- |
| `INVERTER_PROFILE` | string | _(unset)_ | seed only | Active profile id. Optional; when unset the server boots onboarding-only until a profile is installed and activated. Seeds the `activeProfile` setting; changing the active profile takes effect on restart. |
| `INVERTER_HOST` | string | `192.168.1.100` | seed only | Modbus TCP host. |
| `INVERTER_PORT` | number | `502` | seed only | Modbus TCP port. |
| `INVERTER_UNIT_ID` | number | `1` | seed only | Modbus unit / slave id. |
| `INVERTER_SIMULATE` | boolean | `true` | **env-only** | Generate synthetic telemetry instead of reading real hardware. Deliberately deploy-level, not in DB config. |
| `POLL_INTERVAL_MS` | number | `1000` | seed only | Poll cadence in ms (floored at 1000). |
| `HISTORY_FLUSH_INTERVAL_MS` | number | `5000` | **env-only** | How often buffered history rows are flushed to TimescaleDB in one transaction. Batching cuts SSD write wear (TBW) at 1 Hz; live data is unaffected (served from memory). A crash can lose at most this window of history. Set ≤ poll interval to disable batching. |

Two connection fields are DB-only (no env seed): **transport** (`tcp` / `rtu-over-tcp`) and
**timeout** (default 2000 ms). Set them from [Settings → Inverter](/use/settings/).

## Integration API

| Variable | Type | Default | Status | Purpose |
| --- | --- | --- | --- | --- |
| `API_KEYS` | comma-separated string | `""` (none) | env-only | Static keys accepted by the public [`/api/v1`](/integrations/rest-api/) surface, **in addition to** admin-managed keys (Settings → API Keys). Empty = open in dev, **fails closed in production**. |

## MQTT bridge

| Variable | Type | Default | Status | Purpose |
| --- | --- | --- | --- | --- |
| `MQTT_ENABLED` | boolean | `false` | seed only | Enable the MQTT bridge. |
| `MQTT_BROKER_URL` | string | `mqtt://localhost:1883` | seed only | Broker URL. |
| `MQTT_TOPIC_PREFIX` | string | `sunreye` | seed only | Root topic segment: `<prefix>/<inverterId>/<topic>`. |
| `MQTT_USERNAME` | string | — | seed only | Broker username. |
| `MQTT_PASSWORD` | string | — | seed only | Broker password (the DB copy is write-only / masked). |

## Home Assistant discovery

| Variable | Type | Default | Status | Purpose |
| --- | --- | --- | --- | --- |
| `HA_DISCOVERY_ENABLED` | boolean | `false` | seed only | Publish [Home Assistant](/integrations/home-assistant/) MQTT Discovery configs (requires MQTT enabled). |
| `HA_DISCOVERY_PREFIX` | string | `homeassistant` | seed only | HA discovery topic prefix. |

## Web (browser bundle)

| Variable | Type | Default | Required | Purpose |
| --- | --- | --- | --- | --- |
| `PUBLIC_SERVER_URL` | url | — (same-origin) | | Where the *browser* reaches the API. Read at **runtime** via `$env/dynamic/public` — nothing is baked into the image. Unset = resolved from the document URL, which keeps reverse-proxy path prefixes (HA ingress) intact; set it only if you run the SvelteKit app yourself, split-origin. The shipped images do not: the dashboard is embedded in the server binary. |

## Meta

| Variable | Purpose |
| --- | --- |
| `SKIP_ENV_VALIDATION` | If set (truthy), bypasses all env schema validation at import. Useful in CI/build steps. |

## Config with no env var (UI-only)

Some domains are configured entirely from the UI, with defaults from their schema — no env
var exists:

- **Tariff** — currency, standing charge, import bands, feed-in rate. See
  [Statistics](/use/statistics/).
- **Profile sources** — the list of git repos to browse for downloadable profiles. See
  [Distributing Profiles](/profiles/distribution/).

:::caution[Boolean values]
Boolean env vars are parsed from the literal strings `"true"` / `"false"`.
:::
