# 28. Economics crate

Status: accepted (2026-11-19): design accepted, build deferred until after the first release

## Context

Savings and payback are computed in the core from measured energy (ADR 12). An installer's offer needs the same figures before the plant exists, from a modelled yield and a modelled household. Two implementations would disagree on the same plant.

## Decision

A pure `economics` crate, like `pv` (ADR 17): no I/O, no async runtime, built for `wasm32-unknown-unknown`. It takes a yield series, a load series, a battery type (ADR 27) and a tariff (ADR 12), and returns self-consumption, autarky, the bill with and without the plant, savings and payback.

- **Load.** The household's annual consumption shaped by one of a few usage profiles (2026-11-19): the standard household profile, at home by day, away by day, and night-heavy; each a year of quarter-hours that sums to one. Measured load replaces it where it exists.
- **Electric car.** Kilometres a year and consumption per 100 km give its energy; where and when it charges gives its shape: at home in the evening, at home by day, on surplus only, or mostly elsewhere, which leaves a share at home. A car that is planned counts from its year.
- **Other planned loads.** A heat pump and air conditioning, each an annual energy with its own seasonal shape, from the year it starts.
- **Battery.** Charged from surplus and discharged into load, within its type's power, usable capacity and round-trip efficiency. No price-driven dispatch: that is an EMS plan (ADR 1).
- **Tariff.** ADR 12's prices, bands and standing charge. The core's rate arithmetic moves into the crate and the tariff module calls it, with the existing tests as oracles.

## Open before build

- The licence of the BDEW H25 profile for commercial use; the source of the other usage profiles and of the heat pump and air conditioning shapes.
- A second WASM glue crate, which needs an ADR 2 amendment.
- Degradation and price escalation over the payback period.

## Considered options

- **The arithmetic in Plan, in TypeScript.** Rejected: an offer's payback and the app's payback would be two programs.
- **Extending the `pv` crate.** Rejected: money and electrics change for different reasons.
