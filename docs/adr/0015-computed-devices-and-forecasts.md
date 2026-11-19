# 15. Computed devices and forecasts

Status: accepted (2026-11-08), amended (2026-11-09, 2026-11-18, 2026-11-19)

## Context

Prices, tariffs, weather, PV forecasts, plant aggregates and a later EMS all produce numbers. Some are about the future: a day-ahead price or a PV forecast is issued at one time for another. Special tables per feature would give every number its own path.

## Decision

- **Computed devices.** A tariff, a spot-price feed, the weather device and the PV forecast (ADR 17), the `plant` aggregate device (ADR 14) and a later EMS optimiser are devices. They publish readings on the bus, are stored through the same storage, and report capabilities from their declared roles. Each is a core module with a fixed role set; any network fetch runs in its own owned task and serves the last good value. A computed device has a fixed id counted down from 4294967295 (`u32::MAX`), and registered devices count up from 1, so the two never meet: the weather device is 4294967295, the `plant` device 4294967294, the tariff 4294967293 and the spot-price device 4294967292.
- **Forecast store.** Values about the future are stored apart from history, keyed by device, series, issue time and target time, as fixed-point integers. An issue keeps its targets from the start of its own hour; earlier targets are already past. A target in the issue's own hour is kept only where no earlier issue forecast it, so the hour under way shows the forecast made before it began, and a first issue still covers it. Once a target's hour passes, only that target's latest issue is kept: a forecast made before its hour, unless none was, so forecast accuracy can still be compared. The weather device keeps only its latest issue of any target: a new issue replaces the earlier ones of the targets it covers, as no one asks how a weather forecast changed. A target whose value the new issue leaves unchanged keeps its row and earlier issue time, so a forecast that holds writes nothing. An `issuedBefore` read of the weather device sees only the issues it still keeps.
- **When the future arrives.** A day-ahead price becomes a history change point when its slot begins. A forecast stays a forecast; the measured value is history.
- **Plans.** A future EMS writes its plan as forecasts of `plan.*` roles, so the SPA shows plans with the same charts as forecasts.

## Considered options

- **A table per feature (prices, weather, plans).** Rejected: one storage path, one rollup path and one chart path serve all of them.
- **Forecasts in the history store.** Rejected: history has one time axis; a forecast has two.
- **An issue replaces the forecast of its own hour.** Rejected: an issue made at 13:41 knows the weather of 13:00, so a past hour kept a nowcast, not a forecast, and charts showed it as a spike beside the measured value.

## Consequences

The forecast store is a second write path to SQLite and goes through the same storage thread (ADR 2).

A layout or correction change made within an hour reaches the forecast from the next hour on.
