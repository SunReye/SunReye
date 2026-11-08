# 17. Solar forecast and string model

Status: accepted (2026-11-08)

## Context

3.x and v4 forecast PV from up to eight kWp arrays with a tilt and an azimuth: Open-Meteo's tilted irradiance per plane, an incidence-angle loss, a cell-temperature derate and a fixed system loss, then a learned month × hour correction. v4 added a correction per MPPT input. Neither knew the wiring. The owner's plant has MPPT input 1 with two parallel strings of 16 modules, one facing south and one north, and MPPT input 2 with 14 modules facing south. Inverters measure per MPPT input, not per string, and parallel strings share one voltage.

## Decision

**Layout.** The PV layout is the wiring.

- An MPPT input belongs to an inverter. Its count, maximum input current, voltage window and start voltage come from the inverter profile (ADR 5).
- A string is a series of modules of one module type on one plane (tilt, and azimuth with 0 = south, −90 = east, 90 = west), with an optional loss in %. Strings on one MPPT input are in parallel.
- A module type holds datasheet values: Pmax, Vmp, Imp, Voc, Isc and the temperature coefficients of power, voltage and current. The admin enters them; there is no built-in catalogue.
- kWp is derived: modules × Pmax.
- A lint warns when parallel strings on one MPPT input differ in module count.
- Strings and module types have stable ids that are never reused; `pv.string.power` is indexed by string id. A layout change applies from its date, and past estimates keep the layout they were computed with, as for topology (ADR 14).
- The plant's location (latitude, longitude) is entered at first-run setup.

**Weather.** A weather computed device stores global, direct and diffuse irradiance, temperature and wind as `weather.*` forecasts (ADR 15) for the plant's location, at 15-minute resolution for today and two more days. Its task fetches on start and hourly; a handler never fetches. The provider is an adapter at this seam: Open-Meteo forecast, Open-Meteo archive (past weather for learning) and a fake for tests.

**PV model.** The `pv` crate, whose `estimate(layout, weather)` returns series per string, MPPT input and inverter. It is pure: no I/O, no async runtime, no provider knowledge. The gate builds it for `wasm32-unknown-unknown`, so the 3D house builder (ADR 1) can run the same model in the browser; its browser glue arrives with the builder.

- Per string: Perez transposition onto its plane; the Martin–Ruiz incidence-angle loss on the beam and a constant factor on diffuse; cell temperature by Faiman with wind, by the NOCT rise without; current from Isc and voltage from Vmp at that temperature, times the module count; then the string's loss.
- Per MPPT input: parallel currents add and are capped at the maximum input current. Below the voltage window or the start voltage it yields nothing; above the window it is clipped.
- Per inverter: capped at its AC rating. Battery and feed-in curtailment are planning and wait for the EMS stage (ADR 1).
- Perez golden values are generated offline with pvlib and committed as fixtures. Open-Meteo's tilted irradiance is a looser cross-check.

**Parallel-string estimates.** The measured MPPT current is split by each string's modelled current. A string's estimate is the MPPT voltage times its share, so the estimates sum to the measured MPPT power. A string alone on its MPPT input is reported as measured. Estimates are history as `pv.string.power` (ADR 4); the capabilities document marks them `estimated`.

**Correction.** Carried over from 3.x and v4: an exponentially weighted grid by month and plant-local hour of measured ÷ modelled, with the model run on archive weather so cloud-prediction error is not learned, and a half-life of 30 observations. Each MPPT input learns against `pv.mppt.power`, else the inverter's `pv.power`; parallel strings share their input's factor. Hours with the inverter at its AC limit are skipped. Learning runs twice a day. The 3.x and v4 learner cases are oracles.

**Storage.** Forecasts of `pv.string.power`, `pv.mppt.power` and `pv.power` go to the forecast store (ADR 15).

## Open

- Calibrating cell temperature from measured `pv.mppt.voltage`, once a season of voltage history exists.
- Optimizers and shading, with the 3D house builder (ADR 1).

## Considered options

- **kWp arrays (3.x).** Rejected: they cannot express parallel strings or MPPT limits.
- **Tilted irradiance from the provider (3.x).** Rejected: few providers deliver it; plain irradiance makes any weather source an adapter.
- **Power-level providers (Forecast.Solar, Solcast).** Rejected: they bypass the string model, so per-string views vanish.
- **Hay–Davies transposition.** Rejected: simpler, less precise.
- **The PV model as a module inside the core.** Rejected: the 3D builder needs it in the browser, and a crate keeps I/O out by construction.
- **An optimizer count per string now.** Rejected: without a shading model it changes nothing; the string's loss absorbs it.

## Consequences

Inverter profiles gain MPPT limits. `pv.string.power` is an estimate unless its string is alone. The weather seam has two real adapters from day one, because learning needs the archive.
