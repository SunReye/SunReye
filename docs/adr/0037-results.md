# 37. Results

Status: accepted (2026-11-26)

## Context

The `pv` crate already runs a year with Perez transposition, beam and diffuse shading per bypass-diode substring, a typical year and a loss chain (ADR 17), but shows little of it beyond yield. A professional plan explains where a roof is good and what each module loses. ADR 25 lists the simulation's views the builder gains; this ADR fixes them.

## Decision

**On the existing engine.** Results are step 3 of the build order (ADR 30), drawn from the engine as it is: the loss chain, substring shading, Perez sky and typical year (ADR 17). No second model.

**Views.**
- *Irradiance map:* each roof face's annual irradiation in kWh/m² on a sampled grid, by the same shading and sky model as the year's run.
- *Loss per module:* each module's annual loss, broken down by cause.
- *Shadows:* an animation over the day and over the year.
- *Sun path:* the sun's path against the horizon.
- *Loss chain:* a diagram from irradiation on the planes to AC.

**Module tab.** The Module filter (ADR 31) shows the irradiance map before and while modules are placed.

**What the engine keeps.** Beyond today's outputs, a year's run keeps:
- per module, its annual numbers, losses by cause included;
- per roof face, its irradiance sampled on the grid.

## Open

- **Grid** (step 3). The irradiance map's resolution.
- **Colour scale** (step 3). The map's scale and legend.
- **Where** (step 3). Where maps are computed: the browser, the core or both.
- **String losses per module** (step 3). How a loss that arises per string or inverter, as mismatch or clipping, is shared out over its modules.
- **Without a location** (step 3). What the map shows before the plant has a location and a typical year.
- **Shadow dates** (step 3). Which days and times the shadow animation samples over the year.

## Considered options

- **A second, faster model for the views.** Rejected: its numbers would differ from the yield's.

## Consequences

A year's run keeps numbers per module and per face, so what it stores grows with the plant.
