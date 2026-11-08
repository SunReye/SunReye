# 1. Scope and non-goals

Status: proposed (2026-11-08)

## Context

v4 ported a 3.x system and kept surfacing seams. v5 restarts from specs; every later ADR answers to this scope.

## Decision

In scope:

- Read inverters, batteries and meters; store history; show live and historic views.
- Tariff, spot price and savings figures.
- Write a device's settings on an admin's request (ADR 7).
- EVCC and custom sources, as declarative profiles.
- A CLI to create, lint and publish profiles.

Out of scope:

- Automations and optimisation.
- Live control: a write the device reverts unless refreshed.
- Vendor cloud APIs.
- Accounts beyond one admin and read-only viewers; several plants.

## Considered options

- **Monitoring only (v4).** Rejected: the owner needs settings writes.
- **Include live control.** Rejected: setpoints expire on SMA (60 min), Sungrow (20 s heartbeat), Victron (60 s), SolarEdge (command timeout) and Kostal (fallback timer). Refreshing them is a control loop, which is an automation with its own safety case.

## Consequences

A write may reach grid-tied hardware, so ADR 7 gates every one. No ADR may add scheduled or rule-driven writes.
