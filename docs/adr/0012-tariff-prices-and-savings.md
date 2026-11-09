# 12. Tariff, prices and savings

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

Tariff information and savings figures are part of the product. They need a network source (spot prices) and arithmetic over stored energy.

## Decision

- **Tariff.** A computed device (ADR 15) configured by the admin: import and feed-in prices, fixed or in time-of-use bands, evaluated in the plant timezone. It publishes `price.import` and `price.export` readings. Each flow has a base price and bands; a band holds on given weekdays from one wall-clock minute of the plant-local day to a later one, up to 24:00. A night band past midnight is two bands. Bands of one flow never overlap, so no order decides. A band in the hour a DST change skips never applies; in the hour it repeats it applies twice.
- **Spot prices.** Optional, a computed device, off until the admin chooses a bidding zone (`PUT /api/v1/spot-prices`, logged); a zone the core has no source for is refused. Its owned task fetches day-ahead prices into the forecast store, today and tomorrow on the market's calendar, on start and hourly, since the auction clears around 13:00 but not reliably; each slot becomes a `price.spot` history change point when it begins, read from the forecast store, so a failed fetch or a restart serves the last good prices. A slot without a price is unknown: no reading, never 0. A handler never fetches. The first source is energy-charts for DE-LU at 15-minute resolution: keyless, with its CC BY attribution shown in the SPA.
- **Which price wins.** The tariff's `price.import` and `price.export` price the bill; the spot device publishes its own role, `price.spot`, the bidding zone's wholesale price, and no `cost.*` rate reads it. A day-ahead price is not what a household pays: grid fees, levies and VAT sit on top, so the spot price cannot stand in for `price.import`. A tariff that follows the spot price is a tariff feature for when a dynamic tariff needs it.
- **Savings and payback.** The tariff device publishes signed rates in EUR/h from the plant's energy flows and the `price.*` readings in force: `cost.import.rate` (paid), `cost.export.rate` (earned) and `cost.savings.rate`. From the `plant` device's `grid.power` and house `load.power` (ADR 14): import pays the bought power at the import price, export earns the fed-in power at the export price, and savings are the bill without the plant, the whole house load bought, less the bill with it. A rate is published at each reading of a flow or a price while both flows are fresher than the gap threshold, so a silent plant is a gap, not a held cost. Storage integrates them like power (ADR 3), so hourly and daily rollups hold exact EUR, negative prices included, kept forever. Payback sums the daily rollups of `cost.savings.rate` against an investment amount the admin enters (`PUT /api/v1/investment`, logged); `GET /api/v1/payback` returns the investment, the savings and what remains, in EUR to the cent, admin only because it names the investment. `GET /api/v1/costs` returns what was paid, earned and saved per plant-local day over a range, and their total, from the same daily rollups in EUR to the cent; it is history, so a viewer reads it. Nothing is computed in the SPA.
- **Price history.** A tariff has an effective-from date. Editing a tariff changes only the future: a change applying from before now is refused. Correcting the past is an explicit "reprice from date" action by the admin, `POST /api/v1/tariff/reprice` with a tariff version applying from that date: it rebuilds the tariff's `price.*` series and then the `cost.*` series from change points, a day at a time, refuses a date beyond change-point retention (ADR 3), and is logged with the action `reprice`.

## Considered options

- **Computing in the SPA.** Rejected: every client would repeat the arithmetic and could disagree.
- **Clients fetching prices.** Rejected: the same source would be hit per viewer and history would depend on who was watching.
- **Bands that wrap midnight, or overlap with first-match.** Rejected: weekdays become ambiguous past midnight, and an order the admin cannot see would decide the price.
- **The spot device publishing `price.import`, winning over the tariff while it runs.** Rejected: it would price the bill at the wholesale price, without fees and taxes, and the savings would change meaning whenever a fetch failed.
- **Money counters.** Rejected: negative spot prices make them fall, which ADR 3 reads as a reset.
