# 38. Forecasting

Status: accepted (2026-11-26), amended (2026-11-26)

## Context

The core forecasts only solar power, inside its own modules: the solar forecast runs the `pv` model over each weather target in turn on one blocking thread, and the correction and clear-sky index queue behind it on one shared shading table. The house load, which self-consumption and a later EMS plan need, is not forecast. The core must stay responsive on a board as small as a Rock Pi S. The scene format the solar forecast reads is retired by ADR 30.

## Decision

**One crate.** `crates/forecast` makes the solar forecast and the load forecasts. It is pure as `pv` is (ADR 17): no I/O, no async runtime, no provider knowledge. It takes history, weather forecasts, calendar facts and the layout, and returns forecast series; the core fetches, schedules and writes them to the forecast store (ADR 15).
- *Solar.* The solar forecast's model run and the correction learner (ADR 17) move into the crate, which calls `pv` for the physics.
- *Load.* A load model is the crate's seam: it learns from a point's history and forecasts it. Similar days is its one implementation (*Load models*).
- *Grid.* Every forecast runs at 15-minute steps for today and two more days, the weather forecast's and the spot price's reach, and issues when a weather forecast or a new day's history is stored. Targets are UTC instants; a day of 23 or 25 hours has 92 or 100 quarter hours (ADR 3).
- *One value.* A forecast carries one value per target, the expected value, so forecasts of parts sum to the forecast of the whole.

**In the core.** Forecasts run in Home's core, whether or not anyone has a browser open. The core reads the last saved scene through `crates/scene` and shades it with `crates/pv` natively, the same code the browser runs as WASM (ADR 30), so the forecast shades as the builder shows. The browser makes no forecast and the core takes none from it.

**What is forecast.**
- The solar forecast, as ADR 17 says.
- A load forecast per consuming measurement point, the root included: its own consumption (ADR 14), as `point.power` indexed by point id under the `plant` device, never below 0 W. A heat pump or wallbox on its own point is forecast as that point. The house load forecast is their sum, the `plant` device's `load.power`, so the parts sum to the whole as the house load itself does.
- Not the battery's state of charge: that is the outcome of a plan, which the EMS stage writes as `plan.*` (ADR 15).

**Load models.**
- *Similar days:* per point, a profile by day type and quarter hour, exponentially weighted as the correction is, with a temperature term where the point's load follows the outdoor temperature. It reads the day type, the quarter hour, the temperature forecast and the point's mean over the 7 days before the issue.
- *A second model* comes only with evidence: gradient boosting is first tested offline, on history exported from real plants, and joins behind the seam only where it is clearly more accurate there.
- *A wallbox* is forecast from its history alone; reading EVCC's charging plan waits for the EMS stage.
- *Before 14 days* of history: the root's own consumption follows ADR 28's standard household profile, scaled to the plant's mean once it has a day of data; every other point is flat at its own mean of the days so far. Until ADR 28's profile exists, the root is flat too. Such forecasts are marked `estimated` in the capabilities document.
- *Training* reads the last 365 days at most, as quarter-hour means, and skips a quarter hour in which the point or a child of it was unmeasured.
- *Topology.* A point's learned state belongs to its place in the topology version (ADR 14): it starts again when the point's children change, since its own consumption then means something else. A point the topology no longer has is forecast at 0 W, superseding its earlier issues, as a removed string is (ADR 17).
- *Learned state,* the profiles, is stored in SQLite as the correction's grid is, with the model's format version, and learned again daily and when the version changes, a few kB per point. Backups carry it: it reveals less than the history they carry already.

**Day types.** Working day, Saturday, or Sunday and public holiday. The admin picks the plant's federal state in the location settings, preset from the location offline where that is cheap; the crate carries Germany's public holiday rules, Easter's included, and needs no network. Without a state, or outside Germany, only weekends set the day type. School holidays wait.

**Forecast accuracy.** For each solar and load forecast series, over the last 30 days, computed when read, never stored:
- the day-ahead issue's quarter-hour mean absolute error over the measured mean;
- its energy error: forecast less measured over measured, summed over the 30 days, signed.

Where the measured energy is near zero, as an idle wallbox's, both read "—". The day-ahead issue is the last made before the target's plant-local day began, which the store keeps 30 days (ADR 15). The forecasts API returns both figures, and the Forecast screen shows them.

**Speed and size.**
- *Parallel.* `pv` and `forecast` split their work over cores with `rayon`, behind a `parallel` feature: on natively, off in WASM. They split coarsely, over targets, sky-grid nodes and points, never per module: the smallest boards have four slow cores. `crates/scene` operations stay on one thread (ADR 31's 16 ms needs none); its meshes may build in parallel natively.
- *Compute pool.* The core runs every forecast, learning, clear-sky index and year's run in one compute pool (ADR 2), at most two jobs at once, so jobs never add up past the memory budget.
- *Memory by design.* Home must run on the smallest boards. A run streams through its targets rather than holding them all; the shading table is shared, never copied; learned state is loaded per point as it is used.
- *Budgets,* measured by ADR 24's harness (`bun run bench`, `--memory 64m --cpus 0.5`), never asserted in tests; a run more than 20 % slower than the last recorded one is flagged:
  - *Speed:* a solar forecast issue within 5 s, a load forecast issue within 0.5 s, a year's run within 60 s.
  - *Memory:* ADR 24's peak of 48 MB holds during each of them.
  - *Binary:* the release binary's size, set at its first measurement; a commit that grows it by more than 5 % is flagged.
- *Build.* The core is built for size (ADR 2). A crate is built for speed only where a benchmark shows a speed budget needs it and the binary budget holds; this ADR then records the measured gain and cost.

**During the rebuild.** Until `crates/pv` reads `crates/scene` (ADR 30, build order step 3), the solar forecast, the correction and the per-string estimates run unshaded, on each string's plane from the layout form, with no shading table. No old scene path is kept.

**Build order.** The crate is built now, beside the core's rebuild: the load forecasts need no scene.

## Considered options

- **The solar forecast alone, in the core** (ADR 17). Replaced: loads need forecasting too, and a pure crate is tested without I/O.
- **LightGBM** through its C++ library. Rejected: a C++ toolchain in the build, a harder static arm64 binary, and no WASM. Pure-Rust ports of it (`silvic-core`) were too young.
- **Gradient boosting first.** Rejected: it needs months of history and explains nothing; it earns its place by accuracy.
- **Gradient boosting (`perpetual`) beside similar days, a weekly 60-day backtest choosing per point.** Rejected (amended 2026-11-26): a single household's load is mostly people's choices, which no model forecasts a day ahead; what is predictable, the daily shape, day types, temperature and recent level, similar days already reads. Boosting would add dependencies, binary size, memory and a weekly training run on the smallest boards, and the backtest machinery exists only to choose between the two. Tested offline first instead.
- **The house load and its points forecast apart.** Rejected: they would not sum.
- **A new term for the unmeasured remainder.** Rejected: ADR 14's own consumption already is it.
- **Keeping the old scene path until step 3.** Rejected: it is the double geometry ADR 30 removes.
- **The crates single-threaded, the core splitting work.** Rejected: the crate knows where its independent work lies.
- **A Raspberry Pi 5 as the reference, and a hosted CI container.** Rejected: Home must run on the smallest boards, and ADR 24's local harness already measures there.
- **BDEW's H25 for every point before 14 days.** Rejected: it carries no licence (ADR 28), shapes a wallbox as a household, and counted once per point it multiplies the house load.
- **Accuracy stored as history.** Rejected: it needs roles and keys of its own, and is cheap to compute when read.
- **A reserved quantile column.** Rejected: the forecast table holds days, so adding one later is a quick rebuild, not a data migration.
- **`pv` and `forecast` always built for speed.** Rejected: a setting chosen without a measurement; speed, memory and binary size each have a budget instead.
- **Peak memory of 256 MB.** Rejected by the owner: Home must run on the smallest boards; ADR 24's 48 MB holds.

## Consequences

The forecast store keeps a day-ahead issue beside the latest for 30 days (ADR 15). The core gains a compute pool, the location settings a federal state, and the forecasts API the accuracy figures.
