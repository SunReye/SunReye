# 1. Scope and stages

Status: proposed (2026-11-08)

## Context

v4 ported a 3.x system and kept surfacing seams. v5 restarts from specs. The audience is single-household homeowners who monitor their home now and want it energy-managed later; Businesses that sold the software can watch their customers' installs through the relay, with each homeowner's consent. The goal is an all-in-one energy monitoring workspace for a home, with energy management (EMS) as a later stage. YAGNI governs features, not the founding seams: a seam added later means migrating every table, profile and adapter.

## Decision

First release:

- Read inverters, batteries, meters, wallboxes (via EVCC), heat pumps and gas and water meters; store history; show live and historic views.
- Tariff, spot price and savings figures; public data feeds (prices, weather) are allowed.
- Write a device's settings on an admin's request (ADR 7).
- EVCC and custom profiles; a CLI to create, lint and publish profiles.

Designed for, not in the first release:

- Automations and optimisation (EMS). They enter only as controllers through the write funnel (ADR 7), each with its own ADR and safety case.
- Live control: writes the device reverts unless refreshed. Profiles describe them now (ADR 5); only a controller under a lease may use them.
- Remote access and multi-plant views through an end-to-end encrypted relay (ADR 16). Each install is one plant with a global install id.
- Forecasts and plans (ADR 15) and a plant topology (ADR 14).

Out of scope: device vendor clouds, and accounts beyond one admin and read-only viewers.

## Considered options

- **Monitoring only (v4).** Rejected: the owner needs settings writes now and EMS later.
- **Live control in the first release.** Rejected: setpoints expire on SMA (60 min), Sungrow (20 s heartbeat), Victron (60 s), SolarEdge (command timeout) and Kostal (fallback timer). A refresh loop needs the controller seam and its safety case first.
- **Exclude EMS.** Rejected: an EMS added to a monitoring-only design would need a write path, a forecast store and a topology retrofitted under live data.

## Consequences

A write may reach grid-tied hardware, so ADR 7 gates every one. Rule-driven writes exist only as controllers.
