# 15. Computed devices and forecasts

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

Prices, tariffs, weather, PV forecasts, plant aggregates and a later EMS all produce numbers. Some are about the future: a day-ahead price or a PV forecast is issued at one time for another. Special tables per feature would give every number its own path.

## Decision

- **Computed devices.** A tariff, a spot-price feed, the weather device and the PV forecast (ADR 17), the `plant` aggregate device (ADR 14) and a later EMS optimiser are devices. They publish readings on the bus, are stored through the same storage, and report capabilities from their declared roles. Each is a core module with a fixed role set; any network fetch runs in its own owned task and serves the last good value.
- **Forecast store.** Values about the future are stored apart from history, keyed by device, series, issue time and target time, as fixed-point integers. An issue keeps its targets from the start of its own hour, so the latest issue covers that hour whole; earlier targets are already past. After a target hour passes, only its latest issue is kept, so forecast accuracy can still be compared.
- **When the future arrives.** A day-ahead price becomes a history change point when its slot begins. A forecast stays a forecast; the measured value is history.
- **Plans.** A future EMS writes its plan as forecasts of `plan.*` roles, so the SPA shows plans with the same charts as forecasts.

## Considered options

- **A table per feature (prices, weather, plans).** Rejected: one storage path, one rollup path and one chart path serve all of them.
- **Forecasts in the history store.** Rejected: history has one time axis; a forecast has two.

## Consequences

The forecast store is a second write path to SQLite and goes through the same storage thread (ADR 2).
