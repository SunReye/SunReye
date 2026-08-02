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

Inverter connection, poll interval, MQTT/Home-Assistant, and tariff settings are all
DB-backed and editable from the [Settings](/use/settings/) screen — with "Test connection"
and live status — instead of `.env` edits and restarts.

### Downloadable inverter profiles

A [profile SDK](/profiles/authoring/) (typed builders, validation, coverage, scaffold CLI)
plus a [distribution flow](/profiles/distribution/): browse git-hosted repos, download and
install profiles at runtime as validated data, and pick the active profile — no redeploy,
no code execution.

### Platform

Admin roles and first-run onboarding, structured logging, TimescaleDB retention and
compression, RTU-over-TCP transport, and a built-in simulator.

## Planned

### Alerts, reports & automation

- **Threshold alerts & notifications** — low battery SoC, grid outage, fault/alarm status,
  offline inverter — via push, email, webhook, or MQTT.
- **Scheduled reports & data export** — daily/monthly energy + cost summaries.
- **Tariff-aware automation** — schedule battery charge/discharge and grid-charge windows
  around time-of-use tariffs and solar production, through the existing control path.

### Multi-inverter

Run and aggregate several inverters/profiles at once. The narrow metrics schema and
`inverterId` dimension already accommodate this; the work is generalizing the boot-time
manifest/routes/topics from "the active profile" to "per configured inverter."

### UX

- Mobile-friendly polish and an installable PWA.
- Expanded role support (finer-grained view-only vs. control).
- A growing catalog of community-contributed profiles.

:::note
This page supersedes the roadmap in the repository README. For design detail on the profile
system, see [Profiles as Data](/profiles/concept/).
:::
