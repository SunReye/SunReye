---
title: Introduction
description: What SunReye is, and the idea that an inverter is data, not code.
---

**SunReye is a self-hosted monitoring, control, and integration platform for solar / hybrid inverters.**

It polls your inverter over Modbus, stores every reading as time-series data, and gives you
a live dashboard, a typed REST API, and an MQTT bridge with Home Assistant auto-discovery —
all generated from a single description of the inverter.

## The core idea: an inverter is data, not code

Each supported inverter ships as a **profile** — a plain description of its Modbus register
map plus semantic metadata: what each value *means* (PV string power, battery state of
charge, a writable charge-current setting, an enum status, …).

The dashboard, the REST routes, the MQTT topics, and Home Assistant discovery all build
themselves from that profile. Adding a metric — or supporting a whole new inverter — means
adding **data**, not touching the engine.

See [Profiles as data](/profiles/concept/) for how this works end to end.

## What it does today

- **Live monitoring** — polling streamed to the browser over WebSocket. A manifest-driven
  dashboard renders itself from the active device's capabilities (PV strings, battery, grid
  phases, generator, backup load) around a power-flow hero whose nodes open their own
  readings. See [Dashboard](/use/dashboard/).
- **A plant of several devices** — inverters, meters, chargers and controllers, each reached
  through a gateway and each speaking its own profile. Every screen reads the plant as a whole
  or one device at a time. See [Settings → Devices](/use/settings/#devices).
- **History & analytics** — every sample persisted to **TimescaleDB**; per-minute / hourly
  / daily continuous-aggregate rollups make multi-week charts cheap, with automatic
  retention cleanup. See [History & Analytics](/use/history/).
- **Control** — writable settings (charge/discharge currents, work mode, grid charge,
  solar-sell …) exposed as validated controls, guarded by the same validation everywhere.
  See [Controls](/use/controls/).
- **Statistics** — import/export tariffs with time-of-use bands, cost and energy analytics,
  spot price analytics, comparisons and all-time records. See
  [Statistics](/use/statistics/).
- **Automations** — control loops that steer the battery from live PV, the solar forecast and
  day-ahead prices: peak shaving, forecast charging, and making room for negative-price
  windows. See [Automations](/use/automations/).
- **Portable export & import** — the whole instance as one named, schema-independent file, so
  a future SunReye can read it. See [Export & Import](/use/export-import/).
- **Third-party REST API (`/api/v1`)** — an auto-generated integration surface: entity
  catalog, current state, per-entity history, and one *validated* write route per writable
  entity, with OpenAPI docs. API-key authenticated (fails closed in production). See
  [REST API](/integrations/rest-api/).
- **MQTT bridge** — publishes every entity to retained topics, accepts writes, and
  optionally publishes **Home Assistant MQTT Discovery** configs. See
  [MQTT Bridge](/integrations/mqtt/) and [Home Assistant](/integrations/home-assistant/).
- **Downloadable profiles** — browse and install inverter profiles from git-hosted repos
  at runtime; no redeploy. See [Distributing Profiles](/profiles/distribution/).
- **Built-in simulator** — run the whole stack with a coherent fake inverter (no hardware
  needed) for development and demos. See [Quick Start](/start/quick-start/).
- **Auth** — email/password sessions via Better-Auth, with admin roles and first-run
  onboarding. See [Users & Roles](/use/users/).

## Supported inverters

**Deye / Sunsynk** hybrid inverters (≈99 metrics, ≈38 writable) ship as a first-party
profile in the official profile repository. More profiles are added as data — see [Supported Inverters](/profiles/supported/)
and the [Roadmap](/reference/roadmap/).

## Scope

SunReye is deliberately focused: a self-hosted, profile-driven platform for **monitoring,
controlling, and integrating hybrid inverters**, where new hardware and new capabilities
are added as data and configuration — not forks of the engine. It is not a general-purpose
home-automation hub.
