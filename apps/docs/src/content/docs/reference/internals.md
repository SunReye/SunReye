---
title: Architecture Deep-Dive
description: The boot sequence, the profile registry seam, the entity model, and storage — for contributors.
---

This page is for contributors who want to change the engine rather than just author a
[profile](/profiles/concept/). For the high-level picture, start with
[Architecture](/start/architecture/).

## The registry seam

The core of the "inverter is data" design is a small in-memory **profile registry**
(`packages/inverter-core/src/registry.ts`) — a `Map<string, InverterProfile>`. Profiles get
into it two ways:

1. **Code profiles** (first-party npm packages) can self-register via a side-effecting import
   that calls `registerProfile()` and may carry a real `simulate` function and closures. None
   ship in the core today — profiles are authored with `@sunreye/profile-sdk` and downloaded.
2. **Data profiles** (downloaded) are read from the database, validated, **hydrated** into
   the same `InverterProfile` shape, and registered.

Everything downstream — the driver, manifest, capabilities, transports — consumes
`InverterProfile` and never knows whether a profile originated as code or data.

## Data vs. runtime profile shapes

- `ProfileData` (`profile-data.ts`) is the serializable artifact: the download file and the
  `installed_profiles` DB row. Its metrics use a declarative `computeExpr` instead of code.
- `InverterProfile` (`types.ts`) is the runtime shape used by the engine. `hydrateProfile()`
  compiles each `computeExpr` into a real `(values) => number` closure, producing a single
  internal representation.

The [role catalog](/profiles/concept/#the-role-catalog) (`roles.ts`) derives `CanonicalRole`
(`type CanonicalRole = keyof typeof ROLE_CATALOG`) so the type and the runtime data can never
drift. Capability derivation (`capabilities.ts`) turns the set of present roles into the
`InverterCapabilities` the UI renders from, and `buildManifest()` produces the render-ready
view sent to the browser and the API.

## Two-phase, async boot

Profile resolution is asynchronous and runs in `initProfiles()` before any routes, manifest,
or MQTT topics are built:

1. Any code profiles self-register (import side effects) — none in the core today.
2. `loadInstalledProfiles()` reads every `installed_profiles` row, **re-validates** it (a
   stored row may predate a schema change), hydrates and registers it; an invalid row is
   logged and skipped so one bad download can't take the server down.
3. The active profile id is resolved from the `activeProfile` setting (seeded from
   `INVERTER_PROFILE` on first boot), and the engine is built for it.

Because the active profile shapes the REST routes, manifest, and MQTT topics **once at
boot**, switching it is restart-scoped by design — see
[Distributing Profiles](/profiles/distribution/#activation-requires-a-restart).

## The entity model & generated surfaces

Entities are transport-neutral: each metric yields a constraint (bounds, enum, writable) via
`entityConstraint()`. Every transport generates from these:

- The **[REST `/api/v1`](/integrations/rest-api/)** sub-app folds over the writable metrics
  to emit one validated `PUT` route per writable entity, captured into the chain so they
  appear in the OpenAPI spec.
- The **[MQTT bridge](/integrations/mqtt/)** builds state/command/availability topics per
  metric and derives Home Assistant discovery component types from the same constraints.
- The **[dashboard](/use/dashboard/)** resolves every widget by role from the manifest.

Adding a metric extends all three with no route/topic/UI code.

## Polling & reads

One poll loop reads the whole register map per tick and swaps the result in as a single atomic
snapshot, so no transport ever sees a half-updated sample. Under the hood a read is several
Modbus transactions — the map is planned into contiguous blocks (`planReads`), split on address
gaps and the 125-register per-read cap. Because those blocks are sampled milliseconds apart, the
planner groups the raw registers feeding each computed metric into **one spanning block**, so
derived values (efficiency, self-consumption) are computed from registers captured at the same
instant. Groups that exceed the cap, or a device that rejects the spanning read, fall back to
split reads. See [Profiles → Authoring](/profiles/authoring/#compute-expressions) for the
120-register constraint this places on a computed metric's inputs.

## Storage

Telemetry is stored **narrow** — one row per metric per tick, keyed by `inverterId` and
metric key — in a TimescaleDB hypertable (`packages/db`). Continuous aggregates provide
per-minute / hourly / daily rollups; retention and compression policies keep raw data
bounded while preserving long-range trends. A new inverter needs **no migration** because
nothing is vendor-columned.

Runtime settings (inverter connection, MQTT, tariff, profile sources, active profile) live
in an `app_settings` table as JSONB with per-key Zod schemas, hot-reloaded on write (except
the active profile, which is restart-scoped).

## Internal dashboard API

Separate from the stable `/api/v1` surface, the dashboard uses `/api/*` routes (session
auth; mutations admin-only): the manifest (`/api/profile`), the live WebSocket
(`/ws`, one multiplexed connection carrying the `metrics`, `evcc`, `statistics`, `logs` and
`automations` topics), history and rollup endpoints, cost/energy, weather (`/api/weather`), the PV
production forecast (`/api/forecast` for the raw potential and `/api/forecast/usable` for the
post-clipping output — the same canonical shapes published to [MQTT](/integrations/mqtt/)),
and the settings CRUD + test/status endpoints that back the [Settings](/use/settings/) screen. These are internal — integrations should use
[`/api/v1`](/integrations/rest-api/).

## Packages at a glance

See [Architecture → Packages](/start/architecture/#packages) for the full list.
