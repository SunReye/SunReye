# 38. Forecasting

Status: accepted (2026-11-26)

## Context

The core forecasts only solar power, inside its own modules: the solar forecast runs the `pv` model over each weather target in turn on one blocking thread, and the correction and clear-sky index queue behind it on one shared shading table. The house load, which self-consumption and a later EMS plan need, is not forecast. The core must stay responsive on a board as small as a Rock Pi S. The scene format the solar forecast reads is retired by ADR 30.

## Decision

**One crate.** `crates/forecast` forecasts the solar forecast and the load forecasts. It is pure as `pv` is (ADR 17): no I/O, no async runtime, no provider knowledge. It takes history, weather forecasts, calendar facts and the layout, and returns forecast series; the core fetches, schedules and writes them to the forecast store (ADR 15).
- *One seam.* Every forecast is an implementation of one forecast seam. The solar forecast's model run and the correction learner (ADR 17) move into the crate, which calls `pv` for the physics; load models are implementations beside it.
- *Grid.* Every forecast runs at 15-minute steps for today and two more days, the weather forecast's and the spot price's reach, and issues when a weather forecast or a new day's history is stored.
- *One value.* A forecast carries one value per target. The store reserves a quantile column (ADR 15), so a band can come later without migrating data.

**What is forecast.**
- The solar forecast, as ADR 17 says.
- A load forecast per consuming measurement point: its own consumption (ADR 14), as `point.power` indexed by point id under the `plant` device. A heat pump or wallbox on its own point is forecast as that point. The house load forecast is their sum, the `plant` device's `load.power`, so the parts sum to the whole as the house load itself does.
- Not the battery's state of charge: that is the outcome of a plan, which the EMS stage writes as `plan.*` (ADR 15).

**Load models.**
- *Similar days,* the first model: per point, a profile by day type and quarter hour, exponentially weighted as the correction is, with a temperature term where the point's load follows the outdoor temperature. It reads the day type, the quarter hour, the temperature forecast and the point's mean over the last 7 days.
- *Gradient boosting,* the second: the same inputs, trained by `perpetual`, a pure-Rust gradient-boosting library, pinned behind the seam.
- *Choice.* Once a point has 60 days of history, forecast accuracy picks its model, reconsidered weekly.
- *A wallbox* is forecast from its history alone; reading EVCC's charging plan waits for the EMS stage.
- *Before 14 days* of history, a point is forecast by BDEW's standard household profile H25, scaled to the point's own mean once it has a day of data, and marked `estimated` in the capabilities document.
- *Learned state,* the profiles and the boosted models, is stored in SQLite as the correction's grid is: the profiles recomputed daily, the boosted models weekly, a few hundred kB per point.

**Day types.** Working day, Saturday, or Sunday and public holiday. The admin picks the plant's federal state in the location settings, preset from the location where that is cheap; the crate carries Germany's public holiday rules, Easter's included, and needs no network. School holidays wait.

**Forecast accuracy.** For each forecast series, over the last 30 days, the core stores as history the day-ahead issue's quarter-hour mean absolute error over the measured mean, and its daily energy error in %. The day-ahead issue is the last made before the target's plant-local day began, which the store keeps (ADR 15). The Forecast screen shows both.

**Speed.**
- *Parallel.* `pv` and `forecast` split their work over cores with `rayon`, over targets, modules and substrings, behind a `parallel` feature: on natively, off in WASM. `crates/scene` operations stay on one thread (ADR 31's 16 ms needs none); its meshes may build in parallel natively.
- *Compute pool.* The core runs every forecast, learning and year's run in one compute pool (ADR 2), at most two jobs at once, so parallel jobs never add up past the memory budget.
- *Memory by design.* Home must run on the smallest boards. A run streams through its targets rather than holding them all; the shading table is shared, never copied; learned state is loaded per point as it is used.
- *Three budgets,* checked by benchmarks in CI, never by asserted times: on an arm64 runner in a container limited to 256 MB and one host core, a stand-in for a Rock Pi S class board, calibrated once against a real one.
  - *Speed:* a solar forecast issue within 5 s, a load forecast issue within 0.5 s, a year's run within 60 s; a commit that slows one by more than 20 % is flagged.
  - *Memory:* the core's peak resident memory within 64 MB during any of them.
  - *Binary:* the release binary's size, set at its first measurement; a commit that grows it by more than 5 % is flagged.
- *Build.* The core is built for size (ADR 2). A crate is built for speed only where a benchmark shows a speed budget needs it and the binary budget holds; this ADR then records the measured gain and cost.

**During the rebuild.** Until `crates/pv` reads `crates/scene` (ADR 30, build order step 3), the solar forecast, the correction and the per-string estimates run unshaded, on each string's plane from the layout form. No old scene path is kept.

**Build order.** The crate is built now, beside the core's rebuild: the load forecasts need no scene.

## Considered options

- **The solar forecast alone, in the core** (ADR 17). Replaced: loads need forecasting too, and a pure crate is tested without I/O.
- **LightGBM** through its C++ library. Rejected: a C++ toolchain in the build, a harder static arm64 binary, and no WASM. Pure-Rust ports of it (`silvic-core`) were too young; one can replace `perpetual` behind the seam.
- **Gradient boosting first.** Rejected: it needs months of history and explains nothing; it earns its place by accuracy.
- **The house load and its points forecast apart.** Rejected: they would not sum.
- **A new term for the unmeasured remainder.** Rejected: ADR 14's own consumption already is it.
- **Keeping the old scene path until step 3.** Rejected: it is the double geometry ADR 30 removes.
- **The crates single-threaded, the core splitting work.** Rejected: the crate knows where its independent work lies.
- **A Raspberry Pi 5 as the reference.** Rejected: Home must run on the smallest boards.
- **`pv` and `forecast` always built for speed.** Rejected: a setting chosen without a measurement; speed, memory and binary size each have a budget instead.
- **Peak memory of 256 MB.** Rejected by the owner: 64 MB, so Home runs on a board of the smallest class.

## Consequences

The forecast store keeps a day-ahead issue beside the latest (ADR 15). The core gains a compute pool and the location settings a federal state.
