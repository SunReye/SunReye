# 12. Tariff, prices and savings

Status: proposed (2026-11-08)

## Context

Tariff information and savings figures are part of the product. They need a network source (spot prices) and arithmetic over stored energy.

## Decision

- **Tariff.** A setting: import and feed-in prices, fixed or in time-of-use bands, evaluated in the plant timezone.
- **Spot prices.** Optional. One owned task fetches them into SQLite and serves the last good copy; a handler never fetches. The first source is energy-charts for DE-LU at 15-minute resolution: keyless, with its CC BY attribution shown in the SPA.
- **Savings and payback.** Computed in the core from stored energy (ADR 3) and the price in force at the time, not in the SPA. Payback uses an investment amount the admin enters.
- **Price history.** A tariff has an effective-from date. Editing a tariff changes only the future. Correcting the past is an explicit "reprice from date" action by the admin, which recomputes savings from stored energy and is logged.

## Considered options

- **Computing in the SPA.** Rejected: every client would repeat the arithmetic and could disagree.
- **Clients fetching prices.** Rejected: the same source would be hit per viewer and history would depend on who was watching.
