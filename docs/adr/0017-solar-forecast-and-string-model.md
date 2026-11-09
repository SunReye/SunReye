# 17. Solar forecast and string model

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

3.x and v4 forecast PV from up to eight kWp arrays with a tilt and an azimuth: Open-Meteo's tilted irradiance per plane, an incidence-angle loss, a cell-temperature derate and a fixed system loss, then a learned month × hour correction. v4 added a correction per MPPT input. Neither knew the wiring. The owner's plant has MPPT input 1 with two parallel strings of 16 modules, one facing south and one north, and MPPT input 2 with 14 modules facing south. Inverters measure per MPPT input, not per string, and parallel strings share one voltage.

## Decision

**Layout.** The PV layout is the wiring.

- An MPPT input belongs to an inverter. Its count, maximum input current, voltage window and start voltage come from the inverter profile (ADR 5).
- A string is a series of modules of one module type, with an optional loss in %. Each module has a plane (tilt, and azimuth with 0 = south, −90 = east, 90 = west) and may have an optimizer, so a string may span roof faces. Entered by form, a string has one plane for all its modules and a count of optimized modules; a scene (ADR 20) places each module. Strings on one MPPT input are in parallel.
- A module type holds datasheet values: Pmax, Vmp, Imp, Voc, Isc, the temperature coefficients of power, voltage and current, width, height and the number of bypass diodes. The admin enters them; there is no built-in catalogue.
- kWp is derived: modules × Pmax.
- A lint warns when parallel strings on one MPPT input differ in module count.
- Strings and module types have stable ids that are never reused; `pv.string.power` is indexed by string id. A layout change applies from its date, and past estimates keep the layout they were computed with, as for topology (ADR 14).
- The admin adds module types (`POST /api/v1/module-types`) and puts every string with the instant the change applies from (`PUT /api/v1/layout`); a string without an id is new and gets one. Each change is appended as a version with its author and time, which is its change-log entry (ADR 19). `GET /api/v1/layout?at=` returns the version in force at an instant, now by default. Until device configuration exists, a string may name only an inverter the core knows with its profile.
- The plant's location (latitude, longitude) is entered at first-run setup. The admin sets it with `PUT /api/v1/location`; the location module stores it rounded to 0.01° and appends each change to the change log (ADR 19).

**Weather.** A weather computed device stores global, direct and diffuse irradiance, temperature and wind as `weather.*` forecasts (ADR 15) for the plant's location, rounded to 0.01° (about 1 km) before it leaves the home, at 15-minute resolution for today and two more days. Its task fetches on start and hourly while the location is set, and at once when it changes; a handler never fetches. Without a location nothing is fetched. The provider is an adapter at this seam: Open-Meteo forecast, Open-Meteo archive (past weather for learning) and a fake for tests. Archive weather is stored as `weather.*` history, so learning, charts and re-learning after a layout change read it locally.

**PV model.** The `pv` crate, whose `estimate(layout, weather)` returns series per string, MPPT input and inverter. It is pure: no I/O, no async runtime, no provider knowledge. The gate builds it for `wasm32-unknown-unknown`, so the 3D house builder (ADR 1) can run the same model in the browser; its browser glue arrives with the builder.

- Sun position from the plant's location and the time: Meeus's low-precision solar coordinates, geometric and unrefracted, within 0.02° of NREL SPA (pvlib's golden values). SPA's tables of periodic terms buy nothing a PV estimate can see.
- Per module: Perez transposition onto its plane; beam shading per bypass-diode substring from the scene (ADR 20), diffuse unshaded; the Martin–Ruiz incidence-angle loss on the beam and a constant factor on diffuse; cell temperature by Faiman with wind, by the NOCT rise without. A substring with any shaded sample point loses its beam, since its most shaded cell limits its current. The scene reaches the crate as triangles (blocks, roofs, carports), spheres (tree crowns) and upright cylinders (chimneys, poles, trunks).
- Electrics: De Soto's single-diode model, fitted to Vmp, Imp, Voc, Isc and the voltage and current coefficients as pvlib's `fit_desoto`, split into equal substrings. Pmax and the power coefficient feed kWp and nothing else. A conducting bypass diode drops 0.5 V.
- Per string: the current-voltage curve summed over its substrings, with bypass diodes, and its maximum power point; then the string's loss on its current. A module with an optimizer delivers its own maximum power, less 1 %, whatever the string current; a string of optimized modules alone runs at their own maximum power point's current.
- Per MPPT input: parallel strings share one voltage and their currents add; the input runs at the summed curve's peak within its voltage window, at a current no higher than its maximum input current. When the open-circuit voltage stays below the window or the start voltage it yields nothing; a peak above the window is clipped to its top, one below it held at its bottom. Each parallel string's forecast is the input's power split by modelled current, the rule estimates use below, so a string's forecasts sum to its input's.
- Per inverter: capped at its AC rating. Battery and feed-in curtailment are planning and wait for the EMS stage (ADR 1).
- Perez golden values are generated offline with pvlib and committed as fixtures. Open-Meteo's tilted irradiance is a looser cross-check.

**Parallel-string estimates.** The measured MPPT current is split by each string's modelled current. A string's estimate is the measured `pv.mppt.power` times its share, so the estimates sum to it. The modelled currents are the strings' latest solar forecasts at the target nearest the reading, which are split by modelled current; without one, or when they are all 0 W, the strings share equally. A string alone on its MPPT input is reported as measured. Estimates are history as `pv.string.power` (ADR 4), in the solar forecast's 1 W step, since a series' forecast and history share one step; the capabilities document marks them `estimated`.

**Correction.** Carried over from 3.x and v4: an exponentially weighted grid by month and plant-local hour of measured ÷ modelled, with the model run on archive weather so cloud-prediction error is not learned, and a half-life of 30 observations. Each MPPT input learns against `pv.mppt.power`, else the inverter's `pv.power`; parallel strings share their input's factor. Hours with the inverter at its AC limit are skipped. Learning runs twice a day. The 3.x and v4 learner cases are oracles.

**Storage.** The solar forecast issues on start, after each stored weather forecast and after each layout change. Forecasts of `pv.string.power`, `pv.mppt.power` and `pv.power` go to the forecast store (ADR 15). They are stored under each inverter's device, so a series' forecast and history share one device and index. An issue runs the layout in force at each weather target and covers every string, input and inverter any layout version has, at 0 W where the version in force lacks it, so a removed string's earlier issue is superseded.

## Open

- Calibrating cell temperature from measured `pv.mppt.voltage`, once a season of voltage history exists.

## Considered options

- **kWp arrays (3.x).** Rejected: they cannot express parallel strings or MPPT limits.
- **Tilted irradiance from the provider (3.x).** Rejected: few providers deliver it; plain irradiance makes any weather source an adapter.
- **Power-level providers (Forecast.Solar, Solcast).** Rejected: they bypass the string model, so per-string views vanish.
- **Hay–Davies transposition.** Rejected: simpler, less precise.
- **The PV model as a module inside the core.** Rejected: the 3D builder needs it in the browser, and a crate keeps I/O out by construction.
- **One plane per string, no optimizers.** Superseded by ADR 20: shading hits single modules, so each module carries its plane and optimizer.

## Consequences

Inverter profiles gain MPPT limits. `pv.string.power` is an estimate unless its string is alone. The weather seam has two real adapters from day one, because learning needs the archive.
