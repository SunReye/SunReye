# 28. Economics crate

Status: accepted (2026-11-19): design accepted, build deferred until after the first release; amended (2026-11-23): built before SunReye Plan's first offer; amended (2026-11-23): the grid and market rules

## Context

Savings and payback are computed in the core from measured energy (ADR 12). An installer's offer needs the same figures before the plant exists, from a modelled yield and a modelled household. Two implementations would disagree on the same plant.

## Decision

A pure `economics` crate, like `pv` (ADR 17): no I/O, no async runtime, built for `wasm32-unknown-unknown`. It takes a yield series, a load series, a battery type (ADR 27), a tariff (ADR 12) and, from 2026-11-23, the plant's rules and the reference spot year (ADR 29), and returns self-consumption, autarky, the bill with and without the plant, savings and payback.

- **Load.** The household's annual consumption shaped by one of a few usage profiles (2026-11-19): standard, at home by day, away by day, and night-heavy. A profile is a year of measured household days at fine resolution, scaled to the annual consumption, not a smooth average (2026-11-23): a smooth curve overstates self-consumption and flatters every battery, because a household draws power in short peaks. Measured load replaces it where it exists.
- **Electric car.** Kilometres a year and consumption per 100 km give its energy; where and when it charges gives its shape: at home in the evening, at home by day, on surplus only, or mostly elsewhere, which leaves a share at home. A car that is planned counts from its year.
- **Other planned loads.** A heat pump and air conditioning, each an annual energy with its own seasonal shape, from the year it starts.
- **Battery.** Charged from surplus and discharged into load in quarter-hour steps, within its type's power, usable capacity and round-trip efficiency. No price-driven dispatch: that is an EMS plan (ADR 1).
- **Payback and gain (2026-11-23).** Savings in a year are the energy used from the plant at the import price plus the energy fed in at the feed-in rate. They are counted year by year: the yield falls by the module type's degradation, taken from its performance warranty, and the import price grows by a rate that is 0 % unless the caller sets one, since a default above zero would make every offer look better on a forecast. Payback is the year the summed savings pass the price; the gain is the savings over 20 years less the price. The caller prints both rates as assumptions.
- **Export cap (2026-11-23).** In each quarter-hour, after the house load and the battery's charge, export above the cap's share of kWp at the grid point is curtailed and returned as its own figure. A cap met in the inverter arrives already clipped in the yield series (ADR 17) and is not applied again. A quarter-hour's mean hides the peaks inside it, so curtailment is understated a little, and the caller says so. The battery charges from surplus as before, blind to the cap: holding charge back for the midday peak is an EMS plan, so the figure is cautious. A cap that ends when the smart meter gateway's control is tested holds until the year the caller gives for it, and without one for the whole horizon; a cap with no end holds always.
- **Export pay (2026-11-23).** It replaces "fed in at the feed-in rate" above. Each quarter-hour's export earns what the rules give it then: the feed-in rate during its term; 0 while a negative-price zero rule holds and the reference spot year's price at that date and quarter-hour is negative; after the term, market value, plus a bonus while one runs, less the marketer's fee. A negative-price zero rule that starts the year after the gateway is fitted starts after the year the caller gives for that, and without one never. Every modelled year reads the same reference spot year: there is no price forecast. The caller prints the reference year, the fee and the gateway years as assumptions.
- **Yearly costs (2026-11-23).** The meter operator's charge, from the meter cost rule, and the § 14a grid-fee relief, a figure the caller supplies since it differs by grid operator, are lines in every year, counted in savings and payback.
- **The law's extension (2026-11-23).** The 20 years leave out the term the law adds for zeroed quarter-hours (§ 51a EEG); the caller says it exists.
- **Status (2026-11-23).** A result that read a bill rule is a bill figure, and says so with each figure, so a caller cannot print it as law.
- **Tariff.** ADR 12's prices, bands and standing charge. The core's rate arithmetic moves into the crate and the tariff module calls it, with the existing tests as oracles.

## Open before build

- The load data. BDEW's H25 profile carries no licence and is given to the industry for balancing, so it does not ship without BDEW's written consent (still to be asked for). HTW Berlin's profiles are non-commercial. The WPuQ measurements (38 single-family houses, CC BY 4.0) may be embedded; its resolution, and whether household load can be separated from the heat pumps those houses have, are to be checked before the standard profile is built from it. The three other profiles are derived from the same data. The heat pump and air conditioning shapes still need a source.
- A second WASM glue crate, which needs an ADR 2 amendment.

## Considered options

- **The arithmetic in Plan, in TypeScript.** Rejected: an offer's payback and the app's payback would be two programs.
- **Extending the `pv` crate.** Rejected: money and electrics change for different reasons.
