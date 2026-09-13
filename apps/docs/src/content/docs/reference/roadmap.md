---
title: Roadmap
description: What SunReye has shipped and what's planned next.
---

The mission stays fixed: **a self-hosted, profile-driven platform for monitoring,
controlling, and integrating hybrid inverters — where new hardware and new capabilities are
added as data and configuration, not forks of the engine.** Anything that would turn SunReye
into a general-purpose home-automation hub is out of scope.

## Shipped

### Economics — cost tracking & tariffs

Import/export tariffs with flat and time-of-use bands, standing charge and currency; a cost
dashboard with grid cost, export earnings, net bill, savings vs. grid-only, self-sufficiency
and self-consumption. See [Statistics](/use/statistics/).

### Configuration in the UI

Every endpoint the plant talks to is a **connection**, every thing on one is a device or an
[integration](/use/settings/#integrations), and all of it is DB-backed and editable from the
[Settings](/use/settings/) screen — one Add wizard over the server's own catalog, with port
probes, live reads and observed status, instead of `.env` edits and restarts.

### Downloadable inverter profiles

A [profile SDK](/profiles/authoring/) (typed builders, validation, coverage, scaffold CLI)
plus a [distribution flow](/profiles/distribution/): browse git-hosted repos, download and
install profiles at runtime as validated data, and pick the active profile — no redeploy,
no code execution.

### Automations

Peak shaving and forecast charging: a control loop that steers the battery's charge current
from live PV, state of charge and the solar forecast, in an export-maximizing or a
grid-friendly mode, with a shadow (dry-run) mode and a projected plan. Price-aware charging
makes room ahead of negative day-ahead windows and can borrow an EVCC charger as a sink. See
[Automations](/use/automations/).

### A plant of several devices

Devices are a roster, not a single inverter: gateways with inverters, meters, chargers and
controllers on them, each speaking its own profile, each retirable and restorable. Every
screen reads the plant as a whole (aggregated by role) or one device at a time. This release
still *polls* one device — the rest are stored and addressable.

### Amortisation & battery health

What the plant cost against what it has saved over its whole life, read from the lifetime
counters and seasonally weighted; and a measured pack capacity and health inferred from deep
discharges, since no supported inverter reports an SOH. See [Statistics](/use/statistics/).

### Portable export & import

The whole instance as one named, schema-independent file — every reading, the setup, the
settings, profiles and custom charts. See [Export & Import](/use/export-import/).

### Platform

Admin roles and first-run onboarding, a public read-only dashboard for kiosks, an installable
[PWA](/use/dashboard/#install-on-your-phone) so the dashboard opens full-screen from a phone's
home screen, structured logging, TimescaleDB retention and compression, RTU-over-TCP transport,
and a built-in simulator.

## Planned

### Alerts, reports & automation

- **Threshold alerts & notifications** — low battery SoC, grid outage, fault/alarm status,
  offline inverter — via push, email, webhook, or MQTT.
- **Scheduled reports & data export** — daily/monthly energy + cost summaries.
- **More automations** — the engine takes one loop today; the index page and the run-state
  stream are built for several.

### Polling every device

The roster, the per-device history and the plant-wide aggregates have shipped; what is left is
the poll loop itself, which still reads a single device. Each device already carries its own
gateway, address and profile, so the work is running one loop per device rather than one for
the instance.

### UX

- Mobile-friendly polish and an installable PWA.
- Expanded role support (finer-grained view-only vs. control).
- A growing catalog of community-contributed profiles.

:::note
This page supersedes the roadmap in the repository README. For design detail on the profile
system, see [Profiles as Data](/profiles/concept/).
:::
