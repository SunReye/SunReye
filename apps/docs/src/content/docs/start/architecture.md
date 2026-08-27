---
title: Architecture
description: How the inverter profile drives the dashboard, the API, and the MQTT topics.
---

Everything in SunReye derives from one thing: the **active inverter profile**. The profile
is data — a register map plus semantic metadata — and every surface (the dashboard, the
REST API, the MQTT topics, Home Assistant discovery) generates itself from it.

```
Inverter (Modbus TCP)  ──►  Core engine (Elysia)  ──►  TimescaleDB (time-series)
        │                        │  ├─ WebSocket   ──►  Web dashboard (SvelteKit)
        │                        │  ├─ REST /api/v1 ──►  Third-party integrations
        └── (or simulator)       │  └─ MQTT bridge  ──►  Home Assistant / brokers
                                 ▲
                    Inverter profile (data)
             register map + semantic metadata  ──►  drives every surface above
```

## The flow

1. The **core engine** ([`apps/server`](https://github.com/SunReye/SunReye/tree/master/apps/server))
   polls the inverter over Modbus TCP once a second (the "God loop"). No inverter? A
   [built-in simulator](/start/quick-start/) generates coherent fake metrics.
2. Each sample is **broadcast** to browsers over the live WebSocket (`/ws`, topic
   `metrics`) and
   **persisted** to TimescaleDB in *narrow* form — one row per metric per tick.
3. The **manifest** — a capability description built from the profile at boot — drives the
   [SvelteKit dashboard](/use/dashboard/), the auto-generated [REST API](/integrations/rest-api/),
   and the [MQTT bridge](/integrations/mqtt/). Nothing hard-codes vendor register keys.

## Packages

| Package | Role |
| --- | --- |
| [`packages/inverter-core`](https://github.com/SunReye/SunReye/tree/master/packages/inverter-core) | The engine: Modbus codec/driver, the profile registry, capability derivation, and transport-neutral entity descriptors (constraints, bounds, enums) that every transport generates from. |
| [`packages/profile-sdk`](https://github.com/SunReye/SunReye/tree/master/packages/profile-sdk) | Tooling to author, validate, and score inverter profiles. Profiles live in their own repo ([SunReye-Official-Profiles](https://github.com/SunReye/SunReye-Official-Profiles)); the core ships none. |
| [`apps/server`](https://github.com/SunReye/SunReye/tree/master/apps/server) | The core engine (Elysia + Bun): poll loop, WebSocket stream, REST API, MQTT bridge, history endpoints. |
| [`apps/web`](https://github.com/SunReye/SunReye/tree/master/apps/web) | The SvelteKit dashboard. Builds itself from the profile manifest. |
| [`packages/db`](https://github.com/SunReye/SunReye/tree/master/packages/db) | Drizzle schema + TimescaleDB setup. Metrics are stored *narrow*, so a new inverter needs no migration. Also home to DB-backed runtime settings. |
| `packages/env` / `packages/auth` / `packages/config` | Shared env schema (single source of truth), auth, and tooling. |

## Why narrow storage matters

Metrics are stored one row per metric per change, keyed by a device and a metric key —
not as wide vendor-specific columns. Adding a metric, or a whole new inverter, requires
**no database migration**. This is the schema-level expression of "an inverter is data."

On disk that identity is two `int2` foreign keys into the `devices` and `metric_keys`
dimension tables; every external contract still speaks the *names*, resolved at the database
boundary. See [Internals → Storage](/reference/internals/#storage).

## Stack

TypeScript · Bun · Turborepo · SvelteKit 5 + Tailwind v4 · Elysia · Drizzle +
PostgreSQL/TimescaleDB · Better-Auth · MQTT.

For a deeper walk through the boot sequence, the registry seam, and the entity model, see
the [Architecture Deep-Dive](/reference/internals/).
